import "server-only";

import { z } from "zod";

import { getInventoryStore } from "@/lib/inventory/store";
import { getCredentialStore, providerBaseURL } from "@/lib/llm/credentials";
import { type FoodCandidate } from "@/lib/media/recognition";
import { type FoodPreferences } from "@/lib/preferences";
import { getRecipeDetail, searchRecipes } from "@/lib/howtocook";

const dishSchema = z.object({
  name: z.string().min(1).max(100),
  uses: z
    .array(
      z.object({
        batchId: z.string().min(1).max(100),
        quantity: z.number().positive(),
        unit: z.string().min(1).max(16),
      })
    )
    .min(1),
  substitutions: z
    .array(
      z.object({
        ingredient: z.string().min(1).max(80),
        alternatives: z.array(z.string().min(1).max(80)).min(1).max(5),
      })
    )
    .max(8)
    .default([]),
  missingIngredients: z.array(z.string().min(1).max(80)).max(12),
  reason: z.string().min(1).max(300),
});

const recommendationsSchema = z.object({ dishes: z.array(dishSchema).min(3).max(5) });

type AvailableIngredient = { name: string; quantity: number; unit: string; source: "库存" | "照片候选" };

export type MealDish = z.infer<typeof dishSchema> & {
  availableIngredients?: AvailableIngredient[];
  recipeId?: string;
  cover?: string;
  score?: string;
  cooked?: string;
  steps?: Array<{ step: number; desc: string; img?: string }>;
  tips?: string;
  url?: string;
};

export type MealRecommendations = { dishes: MealDish[] };

export type RecommendationParams = {
  mealTime?: "早餐" | "午餐" | "晚餐" | "夜宵" | string;
  diners?: "1人" | "2人" | "3-4人" | "5人以上" | string;
  extraConditions?: string;
  excludeDishes?: string[];
};

export async function recommendMeals(
  preferences: FoodPreferences,
  householdId = "default-household",
  photoCandidates: FoodCandidate[] = [],
  params: RecommendationParams = {}
): Promise<MealRecommendations> {
  const forbidden = [...preferences.allergies, ...preferences.avoidIngredients].map(normalize).filter(Boolean);
  const inventory = getInventoryStore(householdId)
    .listBatches()
    .map((batch) => ({
      id: batch.id,
      name: batch.name,
      quantity: batch.quantity,
      unit: batch.unit,
      expiresAt: batch.expiresAt,
      opened: batch.opened,
      status: batch.status,
      source: "库存" as const,
    }));
  const photo = photoCandidates.map((item, index) => ({
    id: `photo-${index}`,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    expiresAt: "",
    opened: item.opened,
    status: "照片候选",
    source: "照片候选" as const,
  }));
  const ingredients = [...inventory, ...photo].filter((item) => !forbidden.some((term) => normalize(item.name).includes(term)));
  if (!ingredients.length) throw new Error("没有可用于推荐的安全食材，请先入库、拍照识别或检查过敏/禁忌设置");

  const credential = getCredentialStore(householdId).getDecryptedChatCredential();
  if (!credential) throw new Error("请先在高级设置配置模型 Key，或手动查看库存");

  const allowedIds = new Set(ingredients.map((item) => item.id));

  const timeContext = params.mealTime ? `用餐时间段：${params.mealTime}` : "";
  const dinersContext = params.diners ? `就餐人数：${params.diners}` : "";
  const extraContext = params.extraConditions ? `额外条件/用户特别要求：${params.extraConditions}` : "";
  const excludeContext = params.excludeDishes?.length ? `严禁推荐以下菜品或与其高度相似的同义菜品：${params.excludeDishes.join("、")}` : "";

  const response = await fetch(
    `${providerBaseURL(credential.provider, credential.baseUrl) ?? "https://api.openai.com/v1"}/chat/completions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: credential.chatModel,
        temperature: params.excludeDishes?.length ? 0.7 : 0.4,
        response_format:
          credential.provider === "deepseek"
            ? { type: "json_object" }
            : { type: "json_schema", json_schema: { name: "meal_recommendations", strict: false, schema: recommendationsSchema.toJSONSchema({ target: "draft-7" }) } },
        messages: [
          {
            role: "system",
            content: `你是家庭冰箱菜谱助手。必须返回 3 到 5 道菜；优先用临期、已开封食材，再考虑照片候选食材。过敏和禁忌最高优先级：禁止使用、建议或作为替代食材出现。uses 中的 batchId 必须来自食材 JSON，且 uses 中的 quantity 必须是大于 0 的正数数值（严禁为 0 或负数，严禁写成字符串）。substitutions 只列真正可替代的食材；没有则为空数组。missingIngredients 只列确实缺少且常备调料中也没有的配料。遵守最大用时、厨具、烹饪水平、用餐时间段、就餐人数和额外条件。只返回合法 JSON，不要 Markdown，必须符合此 JSON Schema：${JSON.stringify(
              recommendationsSchema.toJSONSchema({ target: "draft-7" })
            )}`,
          },
          {
            role: "system",
            content: `过敏：${JSON.stringify(preferences.allergies)}；禁忌：${JSON.stringify(preferences.avoidIngredients)}；饮食偏好：${
              preferences.dietaryNotes || "无"
            }；可用厨具：${JSON.stringify(preferences.appliances)}；最大用时：${preferences.maxCookingMinutes} 分钟；烹饪水平：${
              preferences.cookingSkill
            }；常备调料：${JSON.stringify(preferences.staples)}；${timeContext}；${dinersContext}；${extraContext}；${excludeContext}；食材 JSON：${JSON.stringify(ingredients)}`,
          },
          {
            role: "user",
            content:
              (photoCandidates.length
                ? "基于冰箱库存和这次照片识别到的候选食材，结合就餐条件，推荐今天可做的菜。"
                : "今天吃什么？请根据我的食材与就餐条件推荐最适合的菜。") +
              (excludeContext
                ? `\n请注意：本次推荐中，严禁包含以下任何菜品或与其高度相似的同义菜品：${params.excludeDishes?.join("、")}。如果你无法找到足够的新菜，可以推荐包含缺失食材的菜，但绝不能包含上述已排除的菜品。`
                : ""),
          },
        ],
      }),
    }
  );

  if (!response.ok) throw new Error("菜式推荐暂时不可用，请稍后重试");
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const rawJson = parseJson(data.choices?.[0]?.message?.content ?? "");
  const cleanedJson = cleanRecommendationJson(rawJson, allowedIds);
  const result = recommendationsSchema.parse(cleanedJson);
  assertSafeRecommendations(result, allowedIds, forbidden, params.excludeDishes ?? []);

  const ingredientById = new Map(ingredients.map((item) => [item.id, item]));

  // Enrich with HowToCook local index details concurrently
  const enrichedDishes: MealDish[] = await Promise.all(
    result.dishes.map(async (dish) => {
      const availableIngredients = dish.uses.flatMap((use) => {
        const ingredient = ingredientById.get(use.batchId);
        return ingredient ? [{ name: ingredient.name, quantity: use.quantity, unit: use.unit, source: ingredient.source }] : [];
      });

      // Search HowToCook for a matching recipe
      let recipeId: string | undefined;
      let cover: string | undefined;
      let score: string | undefined;
      let cooked: string | undefined;
      let steps: Array<{ step: number; desc: string; img?: string }> | undefined;
      let tips: string | undefined;
      let url: string | undefined;

      try {
        const searchResults = await searchRecipes(dish.name, 3);
        if (searchResults.length > 0) {
          const match = searchResults[0];
          recipeId = match.id;
          cover = match.cover;
          score = match.score;
          cooked = match.cooked;
          url = match.url;

          // Fetch full recipe details from HowToCook
          const detail = await getRecipeDetail(match.id);
          if (detail) {
            if (detail.cover) cover = detail.cover;
            if (detail.score) score = detail.score;
            if (detail.cooked) cooked = detail.cooked;
            if (detail.steps && detail.steps.length) steps = detail.steps;
            if (detail.tips) tips = detail.tips;
          }
        }
      } catch (err) {
        console.warn("Failed to fetch HowToCook details for dish:", dish.name, err);
      }

      // If steps are still missing (no HowToCook match), generate clear steps with LLM
      if (!steps || !steps.length) {
        const fallback = await generateFallbackRecipeSteps(
          dish.name,
          [...availableIngredients.map((i) => i.name), ...dish.missingIngredients],
          householdId
        );
        if (fallback.steps.length) {
          steps = fallback.steps;
          if (!tips) tips = fallback.tips;
        }
      }

      return {
        ...dish,
        availableIngredients,
        recipeId,
        cover,
        score,
        cooked,
        steps,
        tips,
        url,
      };
    })
  );

  return { dishes: enrichedDishes };
}

const fallbackStepsSchema = z.object({
  steps: z.array(z.object({ step: z.number(), desc: z.string() })).min(2).max(12),
  tips: z.string().optional().default(""),
});

export async function generateFallbackRecipeSteps(
  dishName: string,
  ingredients: string[],
  householdId = "default-household"
): Promise<{ steps: Array<{ step: number; desc: string; img?: string }>; tips: string }> {
  try {
    const credential = getCredentialStore(householdId).getDecryptedChatCredential();
    if (!credential) return { steps: [], tips: "" };

    const prompt = `请为家常菜“${dishName}”（主要用料：${ingredients.join("、") || "常见调料与食材"}）编写 4 至 8 步条理清晰的烹饪步骤指南和 1 条大厨小贴士。必须返回合法 JSON，格式为 {"steps":[{"step":1,"desc":"步骤描述..."}],"tips":"小贴士..."}`;

    const response = await fetch(
      `${providerBaseURL(credential.provider, credential.baseUrl) ?? "https://api.openai.com/v1"}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: credential.chatModel,
          temperature: 0.3,
          ...(credential.provider === "deepseek" ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: "你是专业大厨。为指定菜品生成步骤详细、家庭易操作的做菜指南。必须只返回 JSON。" },
            { role: "user", content: prompt },
          ],
        }),
      }
    );

    if (!response.ok) return { steps: [], tips: "" };
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { steps: [], tips: "" };

    const parsed = fallbackStepsSchema.parse(parseJson(content));
    return { steps: parsed.steps, tips: parsed.tips || "" };
  } catch (error) {
    console.warn("Failed to generate fallback steps for:", dishName, error);
    return { steps: [], tips: "" };
  }
}

function parseJson(content: string) {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((match?.[1] ?? content).trim());
}

export function assertSafeRecommendations(
  result: { dishes: z.infer<typeof dishSchema>[] },
  allowedIds: Set<string>,
  forbidden: string[],
  excludeDishes: string[] = []
) {
  for (const dish of result.dishes) {
    if (dish.uses.some((use) => !allowedIds.has(use.batchId))) throw new Error("推荐包含不存在或受限的库存批次");
    const content = normalize([dish.name, dish.reason, ...dish.missingIngredients, ...dish.substitutions.flatMap((item) => [item.ingredient, ...item.alternatives])].join(" "));
    if (forbidden.some((term) => content.includes(term))) throw new Error("推荐包含过敏或禁忌食材");
  }
  // 服务端兜底:即便 prompt 要求排除,模型仍可能返回被排除的菜(temperature 升高时更易发生)。
  // 这里对精确菜名命中做剔除,保证"换一批"承诺;同义词不匹配(交给 prompt)。
  if (excludeDishes.length) {
    const excluded = new Set(excludeDishes.map(normalize));
    result.dishes = result.dishes.filter((dish) => !excluded.has(normalize(dish.name)));
    if (result.dishes.length < 3) throw new Error("暂时想不到更多新菜了,请稍后再试或调整口味条件");
  }
}

function normalize(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function cleanRecommendationJson(raw: any, allowedIds: Set<string>): any {
  if (!raw || typeof raw !== "object") return { dishes: [] };
  if (!Array.isArray(raw.dishes)) raw.dishes = [];
  
  raw.dishes = raw.dishes.filter((dish: any) => {
    if (!dish || typeof dish !== "object") return false;
    
    // 规整菜品名称
    if (typeof dish.name !== "string" || !dish.name.trim()) dish.name = "推荐菜品";
    
    // 规整食材消耗 uses
    if (!Array.isArray(dish.uses)) dish.uses = [];
    dish.uses = dish.uses.filter((use: any) => {
      if (!use || typeof use !== "object") return false;
      if (typeof use.batchId !== "string" || !use.batchId) return false;
      
      // 强制转为正数
      let qty = Number(use.quantity);
      if (isNaN(qty) || qty <= 0) {
        qty = 1;
      }
      use.quantity = qty;
      
      if (typeof use.unit !== "string" || !use.unit) use.unit = "份";
      return true;
    });
    
    // 若 uses 列表为空，从 allowedIds 挑一个作为备用，避免 Zod min(1) 校验报错
    if (dish.uses.length === 0) {
      const fallbackId = Array.from(allowedIds)[0];
      if (fallbackId) {
        dish.uses.push({ batchId: fallbackId, quantity: 1, unit: "份" });
      } else {
        return false;
      }
    }
    
    // 规整食材替代 substitutions
    if (!Array.isArray(dish.substitutions)) dish.substitutions = [];
    dish.substitutions = dish.substitutions.filter((sub: any) => {
      if (!sub || typeof sub !== "object") return false;
      if (typeof sub.ingredient !== "string" || !sub.ingredient.trim()) return false;
      if (!Array.isArray(sub.alternatives)) sub.alternatives = [];
      sub.alternatives = sub.alternatives.filter((alt: any) => typeof alt === "string" && alt.trim());
      return sub.alternatives.length > 0;
    });
    
    // 规整缺失食材 missingIngredients
    if (!Array.isArray(dish.missingIngredients)) dish.missingIngredients = [];
    dish.missingIngredients = dish.missingIngredients.filter((item: any) => typeof item === "string" && item.trim());
    
    // 规整推荐理由 reason
    if (typeof dish.reason !== "string" || !dish.reason.trim()) dish.reason = "适合今天烹饪";
    
    return true;
  });
  
  return raw;
}
