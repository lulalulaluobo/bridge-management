import "server-only";

import { z } from "zod";

import { getInventoryStore } from "@/lib/inventory/store";
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
});

export type AgentResponse = {
  message: string;
  mode: "reply" | "clarify" | "propose";
  proposal: OperationProposal | null;
};

export async function respondToUser(input: unknown, householdId = "default-household"): Promise<AgentResponse> {
  const { message, context = [] } = agentRequestSchema.parse(input);
  const credential = getCredentialStore(householdId).getDecryptedChatCredential();
  if (!credential) {
    return { message: "智能对话尚未配置。你仍可用下方手动入库；完成高级设置中的模型 Key 后，我就能理解自然语言、照片和语音。", mode: "reply", proposal: null };
  }

  const inventory = getInventoryStore(householdId).listBatches().slice(0, 80).map((batch) => ({
    id: batch.id, name: batch.name, quantity: batch.quantity, unit: batch.unit, expiresAt: batch.expiresAt, storageLocation: batch.storageLocation, opened: batch.opened,
  }));
  const currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const decision = await requestStructuredDecision(credential.apiKey, credential.chatModel, message, context, inventory, credential.provider, currentDate);
  if (decision.mode !== "propose" || !decision.action) return { message: decision.message, mode: decision.mode, proposal: null };
  return { message: decision.message, mode: "propose", proposal: getInventoryStore(householdId).createProposal(decision.action) };
}

async function requestStructuredDecision(apiKey: string, model: string, message: string, context: Array<{ role: "user" | "assistant"; content: string }>, inventory: unknown[], provider: "openai" | "deepseek", currentDate: string) {
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
        { role: "system", content: `你是家庭冰箱管理 Agent。当前日期是 ${currentDate}（中国时区）；将“今天/明天”等相对日期转换成 YYYY-MM-DD。只能在用户明确要求写入时输出 action；所有 action 都只是待确认草案，绝不声称已写入。库存查询直接回答。新采购食物若没有说明开封状态，默认 opened=false；若没有说明购买日期，默认当前日期；类别可按食物推断，无法推断时用“其他”。未说明预计过期日时不要输出 expiresAt 字段，绝不能填 null、空字符串或猜测日期，系统会按类别默认有效期计算。只有食物名称、数量或用户意图确实不明确时才 mode=clarify 且 action=null。不要编造库存批次 ID。只返回合法 JSON，不要 Markdown，必须符合此 JSON Schema：${JSON.stringify(schema)}` },
        ...(context.length ? [{ role: "system" as const, content: `本次会话最近上下文（仅用来理解代词、补充信息和追问）：${JSON.stringify(context)}` }] : []),
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
