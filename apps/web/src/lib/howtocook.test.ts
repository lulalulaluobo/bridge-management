import { describe, expect, it, beforeAll } from "vitest";

import {
  searchRecipes,
  getRecipeDetail,
  type HowToCookRecipeDetail,
} from "@/lib/howtocook";

// 用 fixture 目录而非 submodule,保证测试独立可重复
beforeAll(() => {
  process.env.HOWTOCOOK_DIR = "src/lib/__fixtures__/howtocook/dishes";
});

describe("howtocook parse — 西红柿炒鸡蛋(无图)", () => {
  let detail: HowToCookRecipeDetail | null;
  beforeAll(async () => {
    detail = await getRecipeDetail("vegetable_dish/西红柿炒鸡蛋");
  });

  it("解析菜名(去掉「的做法」)", () => {
    expect(detail?.name).toBe("西红柿炒鸡蛋");
  });

  it("解析难度星为 score", () => {
    expect(detail?.score).toBe("★★");
  });

  it("解析卡路里为 cooked", () => {
    expect(detail?.cooked).toBe("252 大卡");
  });

  it("无图时 cover 为空字符串", () => {
    expect(detail?.cover).toBe("");
  });

  it("解析原料包含西红柿、鸡蛋", () => {
    const names = detail?.ingredients.map((i) => i.name) ?? [];
    expect(names).toContain("西红柿");
    expect(names).toContain("鸡蛋");
  });

  it("解析操作步骤(≥5 步,首步含「洗净」)", () => {
    expect(detail?.steps.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(detail?.steps[0].desc).toContain("洗净");
  });

  it("解析小贴士且剥离模板致谢语", () => {
    expect(detail?.tips).toContain("番茄酱");
    expect(detail?.tips).not.toContain("Pull request");
  });
});

describe("howtocook parse — 麻婆豆腐(有图)", () => {
  let detail: HowToCookRecipeDetail | null;
  beforeAll(async () => {
    detail = await getRecipeDetail("meat_dish/麻婆豆腐/麻婆豆腐");
  });

  it("解析封面图为 /howtocook 路径", () => {
    expect(detail?.cover).toBe("/howtocook/dishes/meat_dish/麻婆豆腐/1.jpeg");
  });

  it("难度三星", () => {
    expect(detail?.score).toBe("★★★");
  });

  it("步骤 ≥10 步", () => {
    expect(detail?.steps.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  it("url 指向 GitHub 源", () => {
    expect(detail?.url).toContain("github.com/Anduin2017/HowToCook");
  });
});

describe("howtocook searchRecipes 匹配", () => {
  it("同义词召回:番茄炒蛋 → 西红柿炒鸡蛋", async () => {
    const results = await searchRecipes("番茄炒蛋");
    expect(results.some((r) => r.name === "西红柿炒鸡蛋")).toBe(true);
  });

  it("精确命中:麻婆豆腐", async () => {
    const results = await searchRecipes("麻婆豆腐");
    expect(results[0].name).toBe("麻婆豆腐");
  });

  it("无命中返回空数组(交由 LLM 兜底)", async () => {
    const results = await searchRecipes("完全不存在的乱码菜xyz123");
    expect(results).toEqual([]);
  });

  it("未知 id 返回 null", async () => {
    expect(await getRecipeDetail("不存在/的菜")).toBeNull();
  });
});
