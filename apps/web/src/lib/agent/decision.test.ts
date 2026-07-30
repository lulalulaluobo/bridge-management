import { describe, expect, it } from "vitest";

import { fallbackPurchaseAction, formatInventoryReply, formatInventorySpeech, normalizeDecision } from "@/lib/agent/decision";
import { proposalActionSchema } from "@/lib/inventory/types";

describe("agent decision normalization", () => {
  it("lets the server calculate expiry when a model sends null", () => {
    const value = normalizeDecision({
      action: { type: "add_batches", batches: [{ name: "牛奶", category: "乳制品", quantity: 1, unit: "盒", purchasedAt: "2026-07-30", expiresAt: null, storageLocation: "冷藏室", opened: false }] },
    });
    const action = (value as { action: unknown }).action;
    expect(proposalActionSchema.parse(action)).toMatchObject({ type: "add_batches", batches: [{ name: "牛奶" }] });
  });

  it("formats inventory display by line and speech without storage details", () => {
    const inventory = [{ name: "牛奶", quantity: 2, unit: "盒" }, { name: "鸡蛋", quantity: 6, unit: "个" }];
    expect(formatInventoryReply(inventory)).toBe("当前库存\n牛奶2盒\n鸡蛋6个");
    expect(formatInventorySpeech(inventory)).toBe("现在有牛奶2盒、鸡蛋6个。");
  });

  it("falls back to a direct purchase action for one jin of beef", () => {
    const action = fallbackPurchaseAction("我买了一斤牛肉", "2026-07-30", [{ category: "肉类", shelfLifeDays: 3, storageLocation: "冷藏室" }], []);
    expect(action).toMatchObject({ type: "add_batches", batches: [{ name: "牛肉", category: "肉类", quantity: 1, unit: "斤", storageLocation: "冷藏室" }] });
  });

  it("never treats filler words and quantities as food", () => {
    expect(fallbackPurchaseAction("我买了呃两个", "2026-07-30", [{ category: "其他", shelfLifeDays: 7, storageLocation: "冷藏室" }], [])).toBeNull();
  });
});
