import "server-only";

import { z } from "zod";

import { getInventoryStore } from "@/lib/inventory/store";
import { getCredentialStore } from "@/lib/llm/credentials";
import { type FoodCandidate } from "@/lib/media/recognition";
import { type FoodPreferences } from "@/lib/preferences";

const dishSchema = z.object({
  name: z.string().min(1).max(100),
  uses: z.array(z.object({ batchId: z.string().min(1).max(100), quantity: z.number().positive(), unit: z.string().min(1).max(16) })).min(1),
  substitutions: z.array(z.object({ ingredient: z.string().min(1).max(80), alternatives: z.array(z.string().min(1).max(80)).min(1).max(5) })).max(8).default([]),
  missingIngredients: z.array(z.string().min(1).max(80)).max(12),
  reason: z.string().min(1).max(300),
});
const recommendationsSchema = z.object({ dishes: z.array(dishSchema).min(3).max(5) });

type AvailableIngredient = { name: string; quantity: number; unit: string; source: "库存" | "照片候选" };
type MealDish = z.infer<typeof dishSchema> & { availableIngredients?: AvailableIngredient[] };
export type MealRecommendations = { dishes: MealDish[] };

export async function recommendMeals(preferences: FoodPreferences, householdId = "default-household", photoCandidates: FoodCandidate[] = []): Promise<MealRecommendations> {
  const forbidden = [...preferences.allergies, ...preferences.avoidIngredients].map(normalize).filter(Boolean);
  const inventory = getInventoryStore(householdId).listBatches().map((batch) => ({ id: batch.id, name: batch.name, quantity: batch.quantity, unit: batch.unit, expiresAt: batch.expiresAt, opened: batch.opened, status: batch.status, source: "库存" as const }));
  const photo = photoCandidates.map((item, index) => ({ id: `photo-${index}`, name: item.name, quantity: item.quantity, unit: item.unit, expiresAt: "", opened: item.opened, status: "照片候选", source: "照片候选" as const }));
  const ingredients = [...inventory, ...photo].filter((item) => !forbidden.some((term) => normalize(item.name).includes(term)));
  if (!ingredients.length) throw new Error("没有可用于推荐的安全食材，请先入库、拍照识别或检查过敏/禁忌设置");
  const credential = getCredentialStore(householdId).getDecryptedChatCredential();
  if (!credential) throw new Error("请先在高级设置配置模型 Key，或手动查看库存");
  const allowedIds = new Set(ingredients.map((item) => item.id));
  const response = await fetch(credential.provider === "deepseek" ? "https://api.deepseek.com/v1/chat/completions" : "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: credential.chatModel, temperature: 0.4, response_format: credential.provider === "deepseek" ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "meal_recommendations", strict: false, schema: recommendationsSchema.toJSONSchema({ target: "draft-7" }) } }, messages: [
      { role: "system", content: `你是家庭冰箱菜谱助手。必须返回至少三道菜；优先用临期、已开封食材，再考虑照片候选食材。过敏和禁忌最高优先级：禁止使用、建议或作为替代食材出现。uses 中的 batchId 必须来自食材 JSON。substitutions 只列真正可替代的食材；没有则为空数组。missingIngredients 只列确实缺少且常备调料中也没有的配料。遵守最大用时、厨具和烹饪水平。只返回合法 JSON，不要 Markdown，必须符合此 JSON Schema：${JSON.stringify(recommendationsSchema.toJSONSchema({ target: "draft-7" }))}` },
      { role: "system", content: `过敏：${JSON.stringify(preferences.allergies)}；禁忌：${JSON.stringify(preferences.avoidIngredients)}；饮食偏好：${preferences.dietaryNotes || "无"}；可用厨具：${JSON.stringify(preferences.appliances)}；最大用时：${preferences.maxCookingMinutes} 分钟；烹饪水平：${preferences.cookingSkill}；常备调料：${JSON.stringify(preferences.staples)}；食材 JSON：${JSON.stringify(ingredients)}` },
      { role: "user", content: photoCandidates.length ? "基于冰箱库存和这次照片识别到的候选食材，推荐今天可做的菜。" : "今天吃什么？" },
    ] }),
  });
  if (!response.ok) throw new Error("菜式推荐暂时不可用，请稍后重试");
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const result = recommendationsSchema.parse(parseJson(data.choices?.[0]?.message?.content ?? ""));
  assertSafeRecommendations(result, allowedIds, forbidden);
  const ingredientById = new Map(ingredients.map((item) => [item.id, item]));
  return { dishes: result.dishes.map((dish) => ({ ...dish, availableIngredients: dish.uses.flatMap((use) => {
    const ingredient = ingredientById.get(use.batchId);
    return ingredient ? [{ name: ingredient.name, quantity: use.quantity, unit: use.unit, source: ingredient.source }] : [];
  }) })) };
}

function parseJson(content: string) {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((match?.[1] ?? content).trim());
}

export function assertSafeRecommendations(result: MealRecommendations, allowedIds: Set<string>, forbidden: string[]) {
  for (const dish of result.dishes) {
    if (dish.uses.some((use) => !allowedIds.has(use.batchId))) throw new Error("推荐包含不存在或受限的库存批次");
    const content = normalize([dish.name, dish.reason, ...dish.missingIngredients, ...dish.substitutions.flatMap((item) => [item.ingredient, ...item.alternatives])].join(" "));
    if (forbidden.some((term) => content.includes(term))) throw new Error("推荐包含过敏或禁忌食材");
  }
}

function normalize(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}
