import { describe, expect, it } from "vitest";

import { assertSafeRecommendations, type MealRecommendations } from "@/lib/recipes";

const safe: MealRecommendations = { dishes: [
  { name: "菠菜炒蛋", uses: [{ batchId: "b0f7a6b4-1250-4e8e-8af9-7300c7378b86", quantity: 1, unit: "袋" }], substitutions: [{ ingredient: "鸡蛋", alternatives: ["豆腐"] }], missingIngredients: ["鸡蛋"], reason: "优先消耗临期菠菜" },
  { name: "菠菜汤", uses: [{ batchId: "b0f7a6b4-1250-4e8e-8af9-7300c7378b86", quantity: 1, unit: "袋" }], substitutions: [], missingIngredients: ["高汤"], reason: "简单快速" },
  { name: "清炒菠菜", uses: [{ batchId: "b0f7a6b4-1250-4e8e-8af9-7300c7378b86", quantity: 1, unit: "袋" }], substitutions: [], missingIngredients: ["蒜"], reason: "适合已开封食材" },
] };

describe("meal recommendation safety", () => {
  it("rejects recommendations containing forbidden ingredients", () => {
    expect(() => assertSafeRecommendations({ ...safe, dishes: [{ ...safe.dishes[0], missingIngredients: ["花生"] }, ...safe.dishes.slice(1)] }, new Set([safe.dishes[0].uses[0].batchId]), ["花生"])).toThrow("过敏或禁忌");
  });

  it("rejects made-up inventory batch IDs", () => {
    expect(() => assertSafeRecommendations(safe, new Set<string>(), [])).toThrow("不存在");
  });

  it("rejects forbidden substitute ingredients", () => {
    expect(() => assertSafeRecommendations({ ...safe, dishes: [{ ...safe.dishes[0], substitutions: [{ ingredient: "鸡蛋", alternatives: ["花生酱"] }] }, ...safe.dishes.slice(1)] }, new Set([safe.dishes[0].uses[0].batchId]), ["花生"])).toThrow("过敏或禁忌");
  });

  it("filters out dishes whose names match the exclude list (fallback for model non-compliance)", () => {
    const allowed = new Set([safe.dishes[0].uses[0].batchId]);
    // 用副本:assertSafeRecommendations 会就地修改 dishes 列表,避免污染共享的 safe 常量
    const clone = { dishes: safe.dishes.map((d) => ({ ...d })) };
    // 模型不听话:仍返回了一道被排除的菜(菠菜炒蛋),应被剔除,剩余 2 道 < 3 → 抛错
    expect(() => assertSafeRecommendations(clone, allowed, [], ["菠菜炒蛋"])).toThrow("想不到更多新菜");
  });

  it("keeps dishes when exclude list does not match any name", () => {
    const allowed = new Set([safe.dishes[0].uses[0].batchId]);
    const clone = { dishes: safe.dishes.map((d) => ({ ...d })) };
    expect(() => assertSafeRecommendations(clone, allowed, [], ["完全不相关的菜名"])).not.toThrow();
    // 未命中,3 道菜原样保留
    expect(clone.dishes).toHaveLength(3);
  });
});
