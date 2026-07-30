import "server-only";

import { z } from "zod";

import { getInventoryStore } from "@/lib/inventory/store";
import { getCredentialStore } from "@/lib/llm/credentials";
import { type FoodPreferences } from "@/lib/preferences";

const recommendationsSchema = z.object({
  dishes: z.array(z.object({
    name: z.string().min(1).max(100),
    uses: z.array(z.object({ batchId: z.string().uuid(), quantity: z.number().positive(), unit: z.string().min(1).max(16) })).min(1),
    missingIngredients: z.array(z.string().min(1).max(80)),
    reason: z.string().min(1).max(300),
  })).min(3).max(5),
});

export type MealRecommendations = z.infer<typeof recommendationsSchema>;

export async function recommendMeals(preferences: FoodPreferences): Promise<MealRecommendations> {
  const forbidden = [...preferences.allergies, ...preferences.avoidIngredients].map(normalize).filter(Boolean);
  const inventory = getInventoryStore().listBatches().filter((batch) => !forbidden.some((term) => normalize(batch.name).includes(term)));
  if (!inventory.length) throw new Error("没有可用于推荐的安全库存，请先入库或检查过敏/禁忌设置");
  const credential = getCredentialStore().getDecryptedOpenAiCredential();
  if (!credential) throw new Error("请先在高级设置配置模型 Key，或手动查看库存");
  const allowedIds = new Set(inventory.map((batch) => batch.id));
  const snapshot = inventory.map((batch) => ({ id: batch.id, name: batch.name, quantity: batch.quantity, unit: batch.unit, expiresAt: batch.expiresAt, opened: batch.opened, status: batch.status }));
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: credential.chatModel, temperature: 0.4, response_format: { type: "json_schema", json_schema: { name: "meal_recommendations", strict: false, schema: recommendationsSchema.toJSONSchema({ target: "draft-7" }) } }, messages: [
      { role: "system", content: "你是家庭冰箱菜谱助手。必须返回至少三道菜；优先使用临期和已开封食材。禁止使用或建议过敏/禁忌食材，所有 uses.batchId 必须来自库存 JSON。" },
      { role: "system", content: `过敏：${JSON.stringify(preferences.allergies)}；禁忌：${JSON.stringify(preferences.avoidIngredients)}；其他偏好：${preferences.dietaryNotes || "无"}；安全库存：${JSON.stringify(snapshot)}` },
      { role: "user", content: "今天吃什么？" },
    ] }),
  });
  if (!response.ok) throw new Error("菜式推荐暂时不可用，请稍后重试");
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const result = recommendationsSchema.parse(JSON.parse(data.choices?.[0]?.message?.content ?? ""));
  assertSafeRecommendations(result, allowedIds, forbidden);
  return result;
}

export function assertSafeRecommendations(result: MealRecommendations, allowedIds: Set<string>, forbidden: string[]) {
  for (const dish of result.dishes) {
    if (dish.uses.some((use) => !allowedIds.has(use.batchId))) throw new Error("推荐包含不存在或受限的库存批次");
    const content = normalize([dish.name, dish.reason, ...dish.missingIngredients].join(" "));
    if (forbidden.some((term) => content.includes(term))) throw new Error("推荐包含过敏或禁忌食材");
  }
}

function normalize(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}
