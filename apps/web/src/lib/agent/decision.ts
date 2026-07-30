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

const agentRequestSchema = z.object({ message: z.string().trim().min(1).max(1000) });

export type AgentResponse = {
  message: string;
  mode: "reply" | "clarify" | "propose";
  proposal: OperationProposal | null;
};

export async function respondToUser(input: unknown): Promise<AgentResponse> {
  const { message } = agentRequestSchema.parse(input);
  const credential = getCredentialStore().getDecryptedOpenAiCredential();
  if (!credential) {
    return { message: "智能对话尚未配置。你仍可用下方手动入库；完成高级设置中的模型 Key 后，我就能理解自然语言、照片和语音。", mode: "reply", proposal: null };
  }

  const inventory = getInventoryStore().listBatches().slice(0, 80).map((batch) => ({
    id: batch.id, name: batch.name, quantity: batch.quantity, unit: batch.unit, expiresAt: batch.expiresAt, storageLocation: batch.storageLocation, opened: batch.opened,
  }));
  const decision = await requestStructuredDecision(credential.apiKey, credential.chatModel, message, inventory);
  if (decision.mode !== "propose" || !decision.action) return { message: decision.message, mode: decision.mode, proposal: null };
  return { message: decision.message, mode: "propose", proposal: getInventoryStore().createProposal(decision.action) };
}

async function requestStructuredDecision(apiKey: string, model: string, message: string, inventory: unknown[]) {
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
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: { name: "fridge_agent_decision", strict: false, schema } },
      messages: [
        { role: "system", content: "你是家庭冰箱管理 Agent。只能在用户明确要求写入时输出 action；所有 action 都只是待确认草案，绝不声称已写入。库存查询直接回答。信息不足时 mode=clarify 且 action=null。不要编造库存批次 ID。" },
        { role: "system", content: `当前库存 JSON：${JSON.stringify(inventory)}` },
        { role: "user", content: message },
      ],
    }),
  });
  if (!response.ok) throw new Error("模型暂时不可用，请检查 Key、模型权限或网络");
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型未返回可读取结果");
  return decisionSchema.parse(JSON.parse(content));
}
