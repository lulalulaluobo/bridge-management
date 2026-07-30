import { describe, expect, it } from "vitest";

import { normalizeDecision } from "@/lib/agent/decision";
import { proposalActionSchema } from "@/lib/inventory/types";

describe("agent decision normalization", () => {
  it("lets the server calculate expiry when a model sends null", () => {
    const value = normalizeDecision({
      action: { type: "add_batches", batches: [{ name: "牛奶", category: "乳制品", quantity: 1, unit: "盒", purchasedAt: "2026-07-30", expiresAt: null, storageLocation: "冷藏室", opened: false }] },
    });
    const action = (value as { action: unknown }).action;
    expect(proposalActionSchema.parse(action)).toMatchObject({ type: "add_batches", batches: [{ name: "牛奶" }] });
  });
});
