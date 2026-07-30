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

  it("提供可编辑的类别默认位置，并可安全自动入库", () => {
    const store = createStore();
    expect(store.listCategoryDefaults().find((item) => item.category === "主食")).toMatchObject({ shelfLifeDays: 30, storageLocation: "常温柜" });
    store.setFoodDefaultRule("大米", 180, "常温柜");
    const action = { type: "add_batches" as const, batches: [{ name: "大米", category: "主食" as const, quantity: 1, unit: "袋", purchasedAt: "2026-07-30", storageLocation: "常温柜" as const, opened: false }] };
    const first = store.autoConfirm(action, "voice-auto-save");
    const second = store.autoConfirm(action, "voice-auto-save");

    expect(first.action.type).toBe("add_batches");
    if (first.action.type === "add_batches") expect(first.action.batches[0].expiresAt).toBe("2027-01-26");
    expect(second.idempotent).toBe(true);
    expect(store.listBatches("2026-07-30")).toHaveLength(1);
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

  it("修改和消耗也必须通过待确认操作写入", () => {
    const store = createStore();
    const add = store.createProposal({
      type: "add_batches",
      batches: [{ name: "鸡蛋", category: "其他", quantity: 6, unit: "个", purchasedAt: "2026-07-30", storageLocation: "冷藏室", opened: false }],
    });
    const batchId = store.confirmProposal(add.id, "request-e").changedBatchIds[0];
    const update = store.createProposal({ type: "update_batch", batchId, changes: { expiresAt: "2026-08-20", opened: true } });
    store.confirmProposal(update.id, "request-f");
    const consume = store.createProposal({ type: "consume_batch", batchId, quantity: 2 });
    store.confirmProposal(consume.id, "request-g");

    expect(store.listBatches("2026-07-30")[0]).toMatchObject({ quantity: 4, expiresAt: "2026-08-20", opened: true });
  });

  it("家庭之间不能读取或确认对方的库存操作", () => {
    const database = new Database(":memory:");
    const first = new InventoryStore(database, "11111111-1111-4111-8111-111111111111");
    const second = new InventoryStore(database, "22222222-2222-4222-8222-222222222222");
    const proposal = first.createProposal({ type: "add_batches", batches: [{ name: "家庭一牛奶", category: "乳制品", quantity: 1, unit: "盒", purchasedAt: "2026-07-30", storageLocation: "冷藏室", opened: false }] });

    expect(second.listBatches("2026-07-30")).toHaveLength(0);
    expect(() => second.confirmProposal(proposal.id, "other-family")).toThrow("找不到");
    first.confirmProposal(proposal.id, "family-one");
    expect(first.listBatches("2026-07-30")).toHaveLength(1);
    expect(second.listBatches("2026-07-30")).toHaveLength(0);
  });

  it("只为成功写库生成可审计的操作历史", () => {
    const store = createStore();
    const result = store.autoConfirm({ type: "add_batches", batches: [{ name: "牛肉", category: "肉类", quantity: 1, unit: "斤", purchasedAt: "2026-07-30", storageLocation: "冷藏室", opened: false }] }, "agent-audit", "agent");
    expect(result.idempotent).toBe(false);
    expect(store.listOperationHistory()).toMatchObject([{ source: "agent", action: { type: "add_batches", batches: [{ name: "牛肉" }] } }]);
  });
});
