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

function normalizeCategory(cat: string): (typeof foodCategories)[number] {
  if (!cat) return "其他";
  const c = String(cat).trim();
  if ((foodCategories as readonly string[]).includes(c)) return c as (typeof foodCategories)[number];
  if (/肉|禽|排骨|鸡|鸭|猪|牛|羊|香肠|培根|火腿/.test(c)) return "肉类";
  if (/菜|菇|笋|豆|番茄|黄瓜|茄|木耳|西兰花|土豆|胡萝卜/.test(c)) return "蔬菜";
  if (/鱼|虾|蟹|贝|水产|海鲜|鱿鱼|三文鱼/.test(c)) return "海鲜";
  if (/果|苹果|香蕉|桔|橙|莓|葡萄|桃|西瓜/.test(c)) return "水果";
  if (/蛋|奶|乳|芝士|奶酪|酸奶|黄油/.test(c)) return "乳制品";
  if (/米|面|饭|馒头|粉|饺|包子|汤圆|手抓饼|饼|面包/.test(c)) return "主食";
  if (/饮|水|汁|可乐|茶|酒|奶茶|咖啡/.test(c)) return "饮料";
  return "其他";
}

function normalizeLocation(loc: string): (typeof storageLocations)[number] {
  if (!loc) return "冷藏室";
  const l = String(loc).trim();
  if ((storageLocations as readonly string[]).includes(l)) return l as (typeof storageLocations)[number];
  if (/冻/.test(l)) return "冷冻室";
  if (/藏|鲜/.test(l)) return "冷藏室";
  if (/温|柜|桌|架/.test(l)) return "常温柜";
  return "冷藏室";
}

export async function recognizeFoodImage(file: File, householdId = "default-household"): Promise<FoodCandidate[]> {
  if (!file.type.startsWith("image/")) throw new Error("请上传图片文件");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8MB");
  const credential = getCredentialStore(householdId).getDecryptedVisionCredential();
  if (!credential) throw new Error("图片识别需要配置千问视觉或 OpenAI Key，或改用手动入库");
  const image = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  const isQwen = credential.provider === "qwen";
  const basePrompt = `分析这张图片并提取食物信息。图片可能是以下任一类型：
A) 实物食材照片 → 识别看得见或高度确定的食物
B) 购物小票/发票/收据/购物清单 → 从凭证文字中提取食物项目

处理规则：
- 若为小票/发票/清单：优先取凭证上的实际数量和单位；必须跳过非食物项（纸巾、洗衣液、垃圾袋等日用品）
- 若为实物食材：只返回看得见或高度确定的食物
- 数量不确定时用 1
- 必须只返回合法 JSON，不要 Markdown`;
  const systemPrompt = isQwen
    ? `${basePrompt}。格式：{"candidates":[{"name":"食物名","category":"蔬菜","quantity":1,"unit":"份","storageLocation":"冷藏室","opened":false}]}。category 只能是：${foodCategories.join("、")}；storageLocation 只能是：${storageLocations.join("、")}。`
    : `${basePrompt}。格式为 ${JSON.stringify(candidatesSchema.toJSONSchema({ target: "draft-7" }))}`;
  const response = await fetch(isQwen ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" : "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: credential.visionModel,
      temperature: 0,
      ...(isQwen ? {} : { response_format: { type: "json_schema", json_schema: { name: "food_candidates", strict: false, schema: candidatesSchema.toJSONSchema({ target: "draft-7" }) } } }),
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: [{ type: "text", text: "请分析这张图片，提取其中的食物信息。如果是小票或发票，请从文字中提取食物项目。" }, { type: "image_url", image_url: { url: image } }] }],
    }),
  });
  if (!response.ok) throw new Error("图片识别暂时不可用，请改用手动录入");
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const rawText = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseJson(rawText);
  const itemsArray = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.candidates)
      ? parsed.candidates
      : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed?.foods)
          ? parsed.foods
          : [];

  const candidates: FoodCandidate[] = itemsArray
    .map((item: any) => ({
      name: String(item.name || "").trim(),
      category: normalizeCategory(item.category),
      quantity: typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1,
      unit: String(item.unit || "份").trim() || "份",
      storageLocation: normalizeLocation(item.storageLocation),
      opened: Boolean(item.opened),
    }))
    .filter((item: FoodCandidate) => item.name.length > 0);

  return candidates;
}

export async function transcribeAudio(file: File, householdId = "default-household") {
  if (!file.type.startsWith("audio/")) throw new Error("请上传录音文件");
  if (file.size > 20 * 1024 * 1024) throw new Error("录音不能超过 20MB");
  if (process.env.LOCAL_ASR_URL) {
    const body = new FormData();
    body.set("audio", file, file.name || "voice.webm");
    try {
      const response = await fetch(`${process.env.LOCAL_ASR_URL}/transcribe`, { method: "POST", body });
      if (response.status === 503) throw new Error("语音服务正在准备中，请稍后重试或直接输入文字");
      const data = await response.json() as { text?: unknown };
      if (!response.ok || typeof data.text !== "string" || !data.text.trim()) throw new Error("没有识别到清晰语音，请再试一次或直接输入文字");
      return data.text.trim();
    } catch (error) {
      if (error instanceof Error && error.message !== "fetch failed") throw error;
      throw new Error("语音服务暂时不可用，请稍后重试或直接输入文字");
    }
  }
  const credential = getCredentialStore(householdId).getDecryptedChatCredential();
  if (!credential || credential.provider !== "openai") throw new Error("云端语音识别需要配置 OpenAI Key，或改用本地语音服务/文字输入");
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

function parseJson(content: string) {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((match?.[1] ?? content).trim());
}
