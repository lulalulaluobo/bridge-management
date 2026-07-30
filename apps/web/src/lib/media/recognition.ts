import "server-only";

import { z } from "zod";

import { getCredentialStore } from "@/lib/llm/credentials";
import { foodCategories, storageLocations } from "@/lib/inventory/types";

const candidatesSchema = z.object({
  candidates: z.array(z.object({
    name: z.string().min(1).max(80),
    category: z.enum(foodCategories),
    quantity: z.number().positive(),
    unit: z.string().min(1).max(16),
    storageLocation: z.enum(storageLocations),
    opened: z.boolean(),
  })).max(30),
});

export type FoodCandidate = z.infer<typeof candidatesSchema>["candidates"][number];

export async function recognizeFoodImage(file: File): Promise<FoodCandidate[]> {
  if (!file.type.startsWith("image/")) throw new Error("请上传图片文件");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8MB");
  const credential = getCredentialStore().getDecryptedOpenAiCredential();
  if (!credential) throw new Error("请先在高级设置配置模型 Key，或改用手动入库");
  const image = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: credential.visionModel,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "food_candidates", strict: true, schema: candidatesSchema.toJSONSchema({ target: "draft-7" }) } },
      messages: [{ role: "system", content: "识别本次采购的食物。只返回看得见或高度确定的食物；数量不确定时用 1，所有结果都是用户确认前的候选。" }, { role: "user", content: [{ type: "text", text: "请识别这张采购食物照片。" }, { type: "image_url", image_url: { url: image } }] }],
    }),
  });
  if (!response.ok) throw new Error("图片识别暂时不可用，请改用手动录入");
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return candidatesSchema.parse(JSON.parse(data.choices?.[0]?.message?.content ?? "")).candidates;
}

export async function transcribeAudio(file: File) {
  if (!file.type.startsWith("audio/")) throw new Error("请上传录音文件");
  if (file.size > 20 * 1024 * 1024) throw new Error("录音不能超过 20MB");
  const credential = getCredentialStore().getDecryptedOpenAiCredential();
  if (!credential) throw new Error("请先在高级设置配置模型 Key，或改用文字输入");
  const body = new FormData();
  body.set("file", file, file.name || "voice.webm");
  body.set("model", credential.transcriptionModel);
  body.set("language", "zh");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${credential.apiKey}` }, body });
  if (!response.ok) throw new Error("语音识别暂时不可用，请改用文字输入");
  const data = await response.json() as { text?: unknown };
  if (typeof data.text !== "string" || !data.text.trim()) throw new Error("没有识别到可用语音，请改用文字输入");
  return data.text.trim();
}
