import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getAgentSettingsStore } from "@/lib/agent/settings";
import { type ConfirmedWrite, getInventoryStore } from "@/lib/inventory/store";
import { getCredentialStore, providerBaseURL } from "@/lib/llm/credentials";
import { foodCategories, proposalActionSchema, type FoodBatch, type OperationProposal, type ProposalAction } from "@/lib/inventory/types";

const decisionSchema = z.object({
  message: z.string().min(1).max(800),
  speech: z.string().min(1).max(180).optional(),
  mode: z.enum(["reply", "clarify", "propose"]),
  action: proposalActionSchema.nullable(),
});

const agentRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  context: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1000), status: z.enum(["pending", "committed"]).optional() })).max(500).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export type AgentResponse = {
  message: string;
  speech: string;
  mode: "reply" | "clarify" | "propose";
  proposal: OperationProposal | null;
  committed: ConfirmedWrite | null;
};

export async function respondToUser(input: unknown, householdId = "default-household"): Promise<AgentResponse> {
  const { message, context = [], idempotencyKey } = agentRequestSchema.parse(input);
  const store = getInventoryStore(householdId);
  const inventory = store.listBatches().slice(0, 80).map((batch) => ({
    id: batch.id, name: batch.name, quantity: batch.quantity, unit: batch.unit, expiresAt: batch.expiresAt, storageLocation: batch.storageLocation, opened: batch.opened,
  }));
  const credential = getCredentialStore(householdId).getDecryptedChatCredential();
  if (!credential) {
    if (isInventoryQuestion(message)) {
      return { message: formatInventoryReply(inventory), speech: formatInventorySpeech(inventory), mode: "reply", proposal: null, committed: null };
    }
    const reply = "智能对话尚未配置。你仍可手动添加食材。";
    return { message: reply, speech: reply, mode: "reply", proposal: null, committed: null };
  }
  const currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const defaults = store.listCategoryDefaults();
  const foodDefaults = store.listFoodDefaultRules();
  const fallbackAction = () => fallbackPurchaseAction(message, currentDate, defaults, foodDefaults);
  let decision: z.infer<typeof decisionSchema> | null = null;
  try {
    decision = await requestStructuredDecision(credential.apiKey, credential.chatModel, credential.baseUrl, message, context, inventory, defaults, foodDefaults, credential.provider, currentDate);
  } catch (error) {
    const action = fallbackAction();
    if (!action) throw error;
    const foodProblem = foodActionProblem(action, message, context);
    if (foodProblem) return { message: foodProblem, speech: foodProblem, mode: "clarify", proposal: null, committed: null };
    return commitAction(store, action, idempotencyKey, householdId);
  }
  const action = decision.action ?? fallbackAction();
  if (!action) {
    if (isPurchaseRequest(message)) {
      const reply = "没有识别到明确食材，未写入库存。";
      return { message: reply, speech: reply, mode: "clarify", proposal: null, committed: null };
    }
    return { message: decision.message, speech: decision.speech ?? decision.message, mode: decision.mode, proposal: null, committed: null };
  }
  const foodProblem = foodActionProblem(action, message, context);
  if (foodProblem) return { message: foodProblem, speech: foodProblem, mode: "clarify", proposal: null, committed: null };
  return commitAction(store, action, idempotencyKey, householdId);
}

function commitAction(store: ReturnType<typeof getInventoryStore>, action: ProposalAction, idempotencyKey: string | undefined, householdId: string): AgentResponse {
  if (action.type === "add_batches" && !getAgentSettingsStore(householdId).get().naturalLanguageAutoSave) {
    const reply = "已识别食材，请确认是否入库。";
    return { message: reply, speech: reply, mode: "propose", proposal: store.createProposal(action), committed: null };
  }
  const committed = store.autoConfirm(action, idempotencyKey ?? randomUUID(), "agent");
  const reply = formatCommittedAction(committed);
  return { message: reply, speech: reply, mode: "reply", proposal: null, committed };
}

async function requestStructuredDecision(apiKey: string, model: string, baseUrl: string | null, message: string, context: Array<{ role: "user" | "assistant"; content: string; status?: "pending" | "committed" }>, inventory: unknown[], defaults: unknown[], foodDefaults: unknown[], provider: "openai" | "deepseek" | "qwen" | "custom", currentDate: string) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["message", "mode", "action"],
    properties: {
      message: { type: "string" },
      mode: { type: "string", enum: ["reply", "clarify", "propose"] },
      action: { anyOf: [{ type: "null" }, proposalActionSchema.toJSONSchema({ target: "draft-7" })] },
    },
  };
  const response = await fetch(`${providerBaseURL(provider, baseUrl) ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: provider === "deepseek" ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "fridge_agent_decision", strict: false, schema } },
      messages: [
        { role: "system", content: `你是家庭冰箱管理 Agent。当前日期是 ${currentDate}（中国时区）；将"今天/明天"等相对日期转换成 YYYY-MM-DD。

【查询库存】用户问库存时（如"有什么X""还剩什么X""哪些快过期""冷冻室有什么"），必须从当前库存 JSON 中按用户意图筛选匹配项后回复，绝不能无脑输出全部库存。筛选维度：类别（蔬菜/肉类/海鲜/乳制品/主食/水果/饮料等）、存放位置（冷藏室/冷冻室/常温柜等）、过期状态（将 expiresAt 与当前日期比较：已过期的、3天内过期的算"快过期"）、名称关键字模糊匹配。无匹配项时回复"没有找到相关食材"。用户说"有什么"但不加限定时列出全部库存摘要（最多8项）。查询只读不写，mode=reply、action=null。message 里多个项目时每个独占一行。speech 最多 40 个汉字，只说食物名称和数量，绝不说位置或日期。

【写入库存】用户说"买了/新买/入库"时，只要食物名称明确就输出 add_batches；数量未说时默认 1 份，开封状态默认 opened=false，购买日期默认当前日期，类别可按食物推断、无法推断时用"其他"。绝不能把"嗯、呃、啊、这个、那个、两个、一份、一些、东西"等语气词、代词或数量当成食物；食物名称不明确或不在用户本次对话中出现时，必须 mode=clarify 且 action=null，并反问具体食材。用户不必说存放位置或过期日：先匹配"食物默认规则"中同名的规则，再使用"类别默认规则"；存放位置必须取匹配规则的值。未说明预计过期日时不要输出 expiresAt 字段，绝不能填 null、空字符串或猜测日期，后端会按同一优先级计算。写入会由后端直接执行，message 不要要求确认。message 里有多个项目时每个项目独占一行，绝不把清单串成一大段。speech 是给语音播报的一句短话，最多 40 个汉字。只有食物名称或用户意图确实不明确时才 mode=clarify 且 action=null。不要编造库存批次 ID。只返回合法 JSON，不要 Markdown，必须符合此 JSON Schema：${JSON.stringify(schema)}` },
        ...(context.length ? [{ role: "system" as const, content: `本次库存录入会话完整上下文：${JSON.stringify(context)}。重点处理 status=pending 的食材、纠错与补充，已 committed 的内容只用于理解指代、纠错和写入总结；绝不能因后续纠正丢掉此前仍 pending 的其他食材。` }] : []),
        { role: "system", content: `食物默认规则 JSON：${JSON.stringify(foodDefaults)}` },
        { role: "system", content: `类别默认规则 JSON：${JSON.stringify(defaults)}` },
        { role: "system", content: `当前库存 JSON：${JSON.stringify(inventory)}` },
        { role: "user", content: message },
      ],
    }),
  });
  if (!response.ok) throw new Error("模型暂时不可用，请检查 Key、模型权限或网络");
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型未返回可读取结果");
  try {
    return decisionSchema.parse(normalizeDecision(parseJson(content)));
  } catch {
    throw new Error("Agent 返回格式异常，请再试一次");
  }
}

function formatCommittedAction(committed: ConfirmedWrite) {
  if (committed.action.type === "add_batches") return `已记下：${committed.action.batches.map((batch) => `${batch.name}${batch.quantity}${batch.unit}`).join("、")}。`;
  if (committed.action.type === "consume_batch") return "已记录消耗。";
  if (committed.action.type === "soft_delete_batch") return "已从库存移除。";
  return "已更新库存。";
}

function isInventoryQuestion(message: string) {
  const text = message.replace(/\s+/g, "");
  return /^(有什么|有哪些|还剩|剩下)/.test(text) || /(?:库存|冰箱).*(?:有什么|有哪些|还剩|剩下)/.test(text);
}

function isPurchaseRequest(message: string) {
  return /(买了|买到|新买|采购|入库)/.test(message);
}

export function fallbackPurchaseAction(message: string, purchasedAt: string, defaults: Array<{ category: FoodBatch["category"]; shelfLifeDays: number; storageLocation: FoodBatch["storageLocation"] }>, foodDefaults: Array<{ name: string; shelfLifeDays: number; storageLocation: FoodBatch["storageLocation"] }>): ProposalAction | null {
  const trigger = message.match(/(?:买了|买到|新买(?:了)?|采购(?:了)?|入库(?:了)?)\s*([^，。！？!\n]+)/);
  if (!trigger) return null;
  const raw = trigger[1].trim().replace(/(回来|了)$/u, "");
  if (!raw || /[、和及]/u.test(raw)) return null;
  const measured = raw.match(/^([0-9]+(?:\.[0-9]+)?|[一二两三四五六七八九十])\s*(斤|盒|袋|个|瓶|包|份|条|块|只|支|克|公斤|千克)\s*(.+)$/u);
  const quantity = measured ? parseChineseNumber(measured[1]) : 1;
  const unit = measured?.[2] ?? "份";
  const name = (measured?.[3] ?? raw).trim();
  if (!name || !Number.isFinite(quantity) || quantity <= 0 || !isPlausibleFoodName(name)) return null;
  const exact = foodDefaults.find((rule) => rule.name === name);
  const category = inferCategory(name);
  const categoryDefault = defaults.find((rule) => rule.category === category);
  return { type: "add_batches", batches: [{ name, category, quantity, unit, purchasedAt, storageLocation: exact?.storageLocation ?? categoryDefault?.storageLocation ?? "冷藏室", opened: false }] };
}

function foodActionProblem(action: ProposalAction, message: string, context: Array<{ role: "user" | "assistant"; content: string; status?: "pending" | "committed" }>) {
  if (action.type !== "add_batches") return null;
  const userText = [message, ...context.filter((item) => item.role === "user").map((item) => item.content)].join(" ").replace(/[\s，。！？!、,.]/gu, "");
  const invalid = action.batches.find((batch) => !isPlausibleFoodName(batch.name) || !userText.includes(batch.name.replace(/[\s，。！？!、,.]/gu, "")));
  return invalid ? `“${invalid.name}”不是明确食材。请告诉我具体买了什么食物。` : null;
}

function isPlausibleFoodName(name: string) {
  const text = name.trim().replace(/\s+/gu, "");
  if (!text || text.length > 40 || /^(?:嗯+|呃+|啊+|哦+|唔+|哈+|这个|那个|这|那|东西|食物|一?两?个|一份|一些|一点|几个)$/u.test(text)) return false;
  if (/^(?:嗯|呃|啊|哦|唔|哈)+(?:一|二|两|三|四|五|六|七|八|九|十|几|[0-9])*(?:个|份|盒|袋|斤|瓶|包)?$/u.test(text)) return false;
  if (/^[一二两三四五六七八九十0-9]+(?:个|份|盒|袋|斤|瓶|包|克|公斤|千克)?$/u.test(text)) return false;
  return /[\p{Script=Han}a-zA-Z]/u.test(text);
}

function parseChineseNumber(value: string) {
  if (/^\d/.test(value)) return Number(value);
  const values: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return values[value] ?? Number.NaN;
}

function inferCategory(name: string): FoodBatch["category"] {
  if (/(牛|猪|羊|鸡|鸭|肉|排|肠|培根)/u.test(name)) return "肉类";
  if (/(鱼|虾|蟹|贝|蛤|海鲜)/u.test(name)) return "海鲜";
  if (/(奶|酸奶|芝士|黄油)/u.test(name)) return "乳制品";
  if (/(米|面|粉|面包|馒头|饼)/u.test(name)) return "主食";
  if (/(果|苹果|橙|蕉|梨|葡萄|莓)/u.test(name)) return "水果";
  if (/(菜|瓜|椒|豆|菠菜|番茄|土豆|萝卜|菌)/u.test(name)) return "蔬菜";
  if (/(水|茶|咖啡|饮料|可乐|果汁)/u.test(name)) return "饮料";
  return foodCategories.includes(name as FoodBatch["category"]) ? name as FoodBatch["category"] : "其他";
}

export function formatInventoryReply(inventory: Array<{ name: string; quantity: number; unit: string }>) {
  if (!inventory.length) return "冰箱现在是空的。";
  const names = inventory.slice(0, 8).map((batch) => `${batch.name}${batch.quantity}${batch.unit}`);
  return `当前库存\n${names.join("\n")}${inventory.length > names.length ? "\n还有其他食材" : ""}`;
}

export function formatInventorySpeech(inventory: Array<{ name: string; quantity: number; unit: string }>) {
  if (!inventory.length) return "冰箱现在是空的。";
  const names = inventory.slice(0, 8).map((batch) => `${batch.name}${batch.quantity}${batch.unit}`);
  return `现在有${names.join("、")}${inventory.length > names.length ? "等" : ""}。`;
}

export function normalizeDecision(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const decision = value as { action?: unknown };
  if (!decision.action || typeof decision.action !== "object") return value;
  const action = decision.action as { type?: unknown; batches?: unknown };
  if (action.type !== "add_batches" || !Array.isArray(action.batches)) return value;
  return { ...decision, action: { ...action, batches: action.batches.map((batch) => {
    if (!batch || typeof batch !== "object") return batch;
    const { expiresAt, ...rest } = batch as Record<string, unknown>;
    return expiresAt === null || expiresAt === "" ? rest : batch;
  }) } };
}

function parseJson(content: string) {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((match?.[1] ?? content).trim());
}
