import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getAgentSettingsStore } from "@/lib/agent/settings";
import { type ConfirmedWrite, getInventoryStore } from "@/lib/inventory/store";
import { getCredentialStore } from "@/lib/llm/credentials";
import { proposalActionSchema, type OperationProposal } from "@/lib/inventory/types";

const decisionSchema = z.object({
  message: z.string().min(1).max(800),
  mode: z.enum(["reply", "clarify", "propose"]),
  action: proposalActionSchema.nullable(),
});

const agentRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  context: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(1000) })).max(8).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export type AgentResponse = {
  message: string;
  mode: "reply" | "clarify" | "propose";
  proposal: OperationProposal | null;
  committed: ConfirmedWrite | null;
};

export async function respondToUser(input: unknown, householdId = "default-household"): Promise<AgentResponse> {
  const { message, context = [], idempotencyKey } = agentRequestSchema.parse(input);
  const credential = getCredentialStore(householdId).getDecryptedChatCredential();
  if (!credential) {
    return { message: "智能对话尚未配置。你仍可用下方手动入库；完成高级设置中的模型 Key 后，我就能理解自然语言、照片和语音。", mode: "reply", proposal: null, committed: null };
  }

  const inventory = getInventoryStore(householdId).listBatches().slice(0, 80).map((batch) => ({
    id: batch.id, name: batch.name, quantity: batch.quantity, unit: batch.unit, expiresAt: batch.expiresAt, storageLocation: batch.storageLocation, opened: batch.opened,
  }));
  const currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const store = getInventoryStore(householdId);
  const defaults = store.listCategoryDefaults();
  const decision = await requestStructuredDecision(credential.apiKey, credential.chatModel, message, context, inventory, defaults, credential.provider, currentDate);
  if (decision.mode !== "propose" || !decision.action) return { message: decision.message, mode: decision.mode, proposal: null, committed: null };
  if (decision.action.type === "add_batches" && getAgentSettingsStore(householdId).get().naturalLanguageAutoSave) {
    const committed = store.autoConfirm(decision.action, idempotencyKey ?? randomUUID());
    return { message: formatCommittedPurchase(committed), mode: "reply", proposal: null, committed };
  }
  return { message: decision.message, mode: "propose", proposal: store.createProposal(decision.action), committed: null };
}

async function requestStructuredDecision(apiKey: string, model: string, message: string, context: Array<{ role: "user" | "assistant"; content: string }>, inventory: unknown[], defaults: unknown[], provider: "openai" | "deepseek", currentDate: string) {
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
  const response = await fetch(provider === "deepseek" ? "https://api.deepseek.com/v1/chat/completions" : "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: provider === "deepseek" ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "fridge_agent_decision", strict: false, schema } },
      messages: [
        { role: "system", content: `你是家庭冰箱管理 Agent。当前日期是 ${currentDate}（中国时区）；将“今天/明天”等相对日期转换成 YYYY-MM-DD。用户说“买了/新买/入库”时，只要食物名称明确就输出 add_batches；数量未说时默认 1 份，开封状态默认 opened=false，购买日期默认当前日期，类别可按食物推断、无法推断时用“其他”。用户不必说存放位置或过期日：存放位置必须从“类别默认规则”中取对应值；未说明预计过期日时不要输出 expiresAt 字段，绝不能填 null、空字符串或猜测日期，后端会按类别默认有效期计算。message 只需简短说明你理解到的内容，不要要求点击确认，也不要编造已经写入的结果；是否自动写入由用户设置和后端决定。库存查询直接回答。只有食物名称或用户意图确实不明确时才 mode=clarify 且 action=null。不要编造库存批次 ID。只返回合法 JSON，不要 Markdown，必须符合此 JSON Schema：${JSON.stringify(schema)}` },
        ...(context.length ? [{ role: "system" as const, content: `本次会话最近上下文（仅用来理解代词、补充信息和追问）：${JSON.stringify(context)}` }] : []),
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

function formatCommittedPurchase(committed: ConfirmedWrite) {
  if (committed.action.type !== "add_batches") return "已更新冰箱库存。";
  const batches = committed.action.batches.map((batch) => `${batch.name}${batch.quantity}${batch.unit}，放在${batch.storageLocation}，预计${batch.expiresAt}过期`);
  return `已帮你记下：${batches.join("；")}。`;
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
