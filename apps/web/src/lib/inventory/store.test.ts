import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { InventoryStore } from "@/lib/inventory/store";

function createStore() {
  return new InventoryStore(new Database(":memory:"));
}

describe("InventoryStore", () => {
  it("计算默认有效期，并按确认写入批次", () => {
    const store = createStore();
    const proposal = store.createProposal({
      type: "add_batches",
      batches: [{ name: "菠菜", category: "蔬菜", quantity: 1, unit: "袋", purchasedAt: "2026-07-30", storageLocation: "冷藏室", opened: false }],
    });

    expect(proposal.action.type).toBe("add_batches");
    if (proposal.action.type === "add_batches") expect(proposal.action.batches[0].expiresAt).toBe("2026-08-03");

    store.confirmProposal(proposal.id, "request-a", new Date("2026-07-30T00:00:00.000Z"));
    expect(store.listBatches("2026-07-30")).toHaveLength(1);
    expect(store.listBatches("2026-07-30")[0].status).toBe("normal");
  });

  it("以幂等键防止重复确认", () => {
    const store = createStore();
    const proposal = store.createProposal({
      type: "add_batches",
      batches: [{ name: "牛奶", category: "乳制品", quantity: 2, unit: "盒", purchasedAt: "2026-07-30", storageLocation: "冷藏室", opened: false }],
    });
    const first = store.confirmProposal(proposal.id, "request-b");
    const second = store.confirmProposal(proposal.id, "request-b");

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(store.listBatches()).toHaveLength(1);
  });

  it("软删除后不出现在默认库存", () => {
    const store = createStore();
    const add = store.createProposal({
      type: "add_batches",
      batches: [{ name: "酸奶", category: "乳制品", quantity: 1, unit: "杯", purchasedAt: "2026-07-30", storageLocation: "冷藏室", opened: false }],
    });
    const result = store.confirmProposal(add.id, "request-c");
    const deletion = store.createProposal({ type: "soft_delete_batch", batchId: result.changedBatchIds[0] });
    store.confirmProposal(deletion.id, "request-d");

    expect(store.listBatches()).toHaveLength(0);
  });
});
