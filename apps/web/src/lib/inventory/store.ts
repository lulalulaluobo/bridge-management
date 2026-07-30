import "server-only";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { addDays, statusForExpiration, todayInShanghai } from "@/lib/inventory/date";
import {
  type BatchInput,
  type FoodBatch,
  type FoodBatchWithStatus,
  type OperationProposal,
  proposalActionSchema,
  type ProposalAction,
} from "@/lib/inventory/types";

const DEFAULT_HOUSEHOLD_ID = "default-household";
const PROPOSAL_TTL_MS = 15 * 60 * 1000;

type BatchRow = {
  id: string;
  household_id: string;
  name: string;
  category: FoodBatch["category"];
  quantity: number;
  unit: string;
  purchased_at: string;
  expires_at: string;
  storage_location: FoodBatch["storageLocation"];
  opened: number;
  created_at: string;
  updated_at: string;
};

type ProposalRow = {
  id: string;
  action_json: string;
  expires_at: string;
};

export type ConfirmedWrite = {
  proposalId: string;
  action: ProposalAction;
  changedBatchIds: string[];
  idempotent: boolean;
};

export type OperationHistoryItem = { id: string; action: ProposalAction; changedBatchIds: string[]; source: "agent" | "manual"; detail: string; createdAt: string };

export class InventoryStore {
  constructor(private readonly db: Database.Database, private readonly householdId = DEFAULT_HOUSEHOLD_ID) {
    this.initialize();
  }

  private initialize() {
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS households (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS category_defaults (
        household_id TEXT NOT NULL,
        category TEXT NOT NULL,
        shelf_life_days INTEGER NOT NULL CHECK (shelf_life_days >= 0),
        storage_location TEXT NOT NULL DEFAULT '冷藏室',
        PRIMARY KEY (household_id, category)
      );
      CREATE TABLE IF NOT EXISTS food_default_rules (
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        shelf_life_days INTEGER NOT NULL CHECK (shelf_life_days >= 0),
        storage_location TEXT NOT NULL,
        PRIMARY KEY (household_id, name)
      );
      CREATE TABLE IF NOT EXISTS food_batches (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity >= 0),
        unit TEXT NOT NULL,
        purchased_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        storage_location TEXT NOT NULL,
        opened INTEGER NOT NULL CHECK (opened IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS food_batches_household_active ON food_batches (household_id, deleted_at, expires_at);
      CREATE TABLE IF NOT EXISTS operation_proposals (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        action_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'confirmed', 'cancelled')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        confirmed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS write_requests (
        idempotency_key TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operation_history (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        action_json TEXT NOT NULL,
        changed_batch_ids_json TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('agent', 'manual')),
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operation_history_lookup ON operation_history (household_id, created_at DESC);
    `);

    const now = new Date().toISOString();
    const categoryDefaultColumns = this.db.prepare("PRAGMA table_info(category_defaults)").all() as Array<{ name: string }>;
    const needsStorageDefaultsMigration = !categoryDefaultColumns.some((column) => column.name === "storage_location");
    if (needsStorageDefaultsMigration) this.db.exec("ALTER TABLE category_defaults ADD COLUMN storage_location TEXT NOT NULL DEFAULT '冷藏室'");
    const historyColumns = this.db.prepare("PRAGMA table_info(operation_history)").all() as Array<{ name: string }>;
    if (!historyColumns.some((column) => column.name === "detail")) this.db.exec("ALTER TABLE operation_history ADD COLUMN detail TEXT");
    this.db.prepare("INSERT OR IGNORE INTO households (id, created_at) VALUES (?, ?)").run(this.householdId, now);
    const defaults: Array<[FoodBatch["category"], number, FoodBatch["storageLocation"]]> = [["蔬菜", 4, "冷藏室"], ["水果", 7, "冷藏室"], ["乳制品", 7, "冷藏室"], ["肉类", 3, "冷藏室"], ["海鲜", 2, "冷冻室"], ["主食", 30, "常温柜"], ["饮料", 14, "常温柜"], ["其他", 7, "冷藏室"]];
    const insert = this.db.prepare("INSERT OR IGNORE INTO category_defaults (household_id, category, shelf_life_days, storage_location) VALUES (?, ?, ?, ?)");
    for (const [category, days, storageLocation] of defaults) insert.run(this.householdId, category, days, storageLocation);
    if (needsStorageDefaultsMigration) {
      const updateStorage = this.db.prepare("UPDATE category_defaults SET storage_location = ? WHERE household_id = ? AND category = ?");
      for (const [category, , storageLocation] of defaults) updateStorage.run(storageLocation, this.householdId, category);
    }
  }

  setCategoryDefault(category: FoodBatch["category"], shelfLifeDays: number, storageLocation: FoodBatch["storageLocation"]) {
    this.db.prepare(`INSERT INTO category_defaults (household_id, category, shelf_life_days, storage_location) VALUES (?, ?, ?, ?)
      ON CONFLICT(household_id, category) DO UPDATE SET shelf_life_days = excluded.shelf_life_days, storage_location = excluded.storage_location`).run(this.householdId, category, shelfLifeDays, storageLocation);
  }

  getCategoryDefault(category: FoodBatch["category"]): number | null {
    const row = this.db.prepare("SELECT shelf_life_days FROM category_defaults WHERE household_id = ? AND category = ?").get(this.householdId, category) as { shelf_life_days: number } | undefined;
    return row?.shelf_life_days ?? null;
  }

  listCategoryDefaults(): Array<{ category: FoodBatch["category"]; shelfLifeDays: number; storageLocation: FoodBatch["storageLocation"] }> {
    const rows = this.db.prepare("SELECT category, shelf_life_days, storage_location FROM category_defaults WHERE household_id = ? ORDER BY category").all(this.householdId) as Array<{ category: FoodBatch["category"]; shelf_life_days: number; storage_location: FoodBatch["storageLocation"] }>;
    return rows.map((row) => ({ category: row.category, shelfLifeDays: row.shelf_life_days, storageLocation: row.storage_location }));
  }

  listFoodDefaultRules(): Array<{ name: string; shelfLifeDays: number; storageLocation: FoodBatch["storageLocation"] }> {
    const rows = this.db.prepare("SELECT name, shelf_life_days, storage_location FROM food_default_rules WHERE household_id = ? ORDER BY name").all(this.householdId) as Array<{ name: string; shelf_life_days: number; storage_location: FoodBatch["storageLocation"] }>;
    return rows.map((row) => ({ name: row.name, shelfLifeDays: row.shelf_life_days, storageLocation: row.storage_location }));
  }

  setFoodDefaultRule(name: string, shelfLifeDays: number, storageLocation: FoodBatch["storageLocation"]) {
    this.db.prepare(`INSERT INTO food_default_rules (household_id, name, shelf_life_days, storage_location) VALUES (?, ?, ?, ?)
      ON CONFLICT(household_id, name) DO UPDATE SET shelf_life_days = excluded.shelf_life_days, storage_location = excluded.storage_location`).run(this.householdId, name.trim(), shelfLifeDays, storageLocation);
  }

  deleteFoodDefaultRule(name: string) {
    this.db.prepare("DELETE FROM food_default_rules WHERE household_id = ? AND name = ?").run(this.householdId, name.trim());
  }

  autoConfirm(action: ProposalAction, idempotencyKey: string, source: "agent" | "manual" = "manual"): ConfirmedWrite {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("无效的幂等键");
    const existing = this.db.prepare("SELECT result_json FROM write_requests WHERE idempotency_key = ?").get(idempotencyKey) as { result_json: string } | undefined;
    if (existing) return { ...(JSON.parse(existing.result_json) as ConfirmedWrite), idempotent: true };
    const proposal = this.createProposal(action);
    return this.confirmProposal(proposal.id, idempotencyKey, new Date(), source);
  }

  listBatches(today = todayInShanghai()): FoodBatchWithStatus[] {
    const rows = this.db.prepare(`SELECT * FROM food_batches WHERE household_id = ? AND deleted_at IS NULL AND quantity > 0
      ORDER BY expires_at ASC, created_at DESC`).all(this.householdId) as BatchRow[];
    return rows.map((row) => ({ ...toBatch(row), status: statusForExpiration(row.expires_at, today) }));
  }

  getBatch(batchId: string): FoodBatch | null {
    const row = this.db.prepare("SELECT * FROM food_batches WHERE id = ? AND household_id = ? AND deleted_at IS NULL").get(batchId, this.householdId) as BatchRow | undefined;
    return row ? toBatch(row) : null;
  }

  listOperationHistory(limit = 100): OperationHistoryItem[] {
    const rows = this.db.prepare("SELECT id, action_json, changed_batch_ids_json, source, detail, created_at FROM operation_history WHERE household_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(this.householdId, Math.max(1, Math.min(limit, 200))) as Array<{ id: string; action_json: string; changed_batch_ids_json: string; source: "agent" | "manual"; detail: string | null; created_at: string }>;
    return rows.map((row) => {
      const action = proposalActionSchema.parse(JSON.parse(row.action_json));
      const changedBatchIds = JSON.parse(row.changed_batch_ids_json) as string[];
      return { id: row.id, action, changedBatchIds, source: row.source, detail: row.detail ?? this.describeHistoryAction(action), createdAt: row.created_at };
    });
  }

  createProposal(action: ProposalAction, now = new Date()): OperationProposal {
    const normalized = normalizeAction(action, this);
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString();
    this.db.prepare("INSERT INTO operation_proposals (id, household_id, action_json, state, expires_at, created_at) VALUES (?, ?, ?, 'pending', ?, ?)")
      .run(id, this.householdId, JSON.stringify(normalized), expiresAt, now.toISOString());
    return { id, action: normalized, expiresAt };
  }

  confirmProposal(proposalId: string, idempotencyKey: string, now = new Date(), source: "agent" | "manual" = "manual"): ConfirmedWrite {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("无效的幂等键");
    const existing = this.db.prepare("SELECT result_json FROM write_requests WHERE idempotency_key = ?").get(idempotencyKey) as { result_json: string } | undefined;
    if (existing) return { ...(JSON.parse(existing.result_json) as ConfirmedWrite), idempotent: true };

    const run = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM operation_proposals WHERE id = ? AND household_id = ?").get(proposalId, this.householdId) as ProposalRow | undefined;
      if (!row) throw new Error("找不到待确认操作");
      if (new Date(row.expires_at) < now) throw new Error("此操作已过期，请重新确认");
      const state = this.db.prepare("SELECT state FROM operation_proposals WHERE id = ?").get(proposalId) as { state: string };
      if (state.state !== "pending") throw new Error("此操作已处理，请刷新后查看库存");
      const action = proposalActionSchema.parse(JSON.parse(row.action_json));
      const detail = this.describeHistoryAction(action);
      const changedBatchIds = this.applyAction(action, now.toISOString());
      const result: ConfirmedWrite = { proposalId, action, changedBatchIds, idempotent: false };
      this.db.prepare("UPDATE operation_proposals SET state = 'confirmed', confirmed_at = ? WHERE id = ?").run(now.toISOString(), proposalId);
      this.db.prepare("INSERT INTO write_requests (idempotency_key, proposal_id, result_json, created_at) VALUES (?, ?, ?, ?)")
        .run(idempotencyKey, proposalId, JSON.stringify(result), now.toISOString());
      this.db.prepare("INSERT INTO operation_history (id, household_id, action_json, changed_batch_ids_json, source, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), this.householdId, JSON.stringify(action), JSON.stringify(changedBatchIds), source, detail, now.toISOString());
      return result;
    });
    return run();
  }

  private applyAction(action: ProposalAction, timestamp: string): string[] {
    switch (action.type) {
      case "add_batches": {
        const insert = this.db.prepare(`INSERT INTO food_batches
          (id, household_id, name, category, quantity, unit, purchased_at, expires_at, storage_location, opened, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        return action.batches.map((batch) => {
          const id = randomUUID();
          insert.run(id, this.householdId, batch.name, batch.category, batch.quantity, batch.unit, batch.purchasedAt, batch.expiresAt, batch.storageLocation, batch.opened ? 1 : 0, timestamp, timestamp);
          return id;
        });
      }
      case "update_batch": {
        const current = this.requireBatch(action.batchId);
        const next = { ...current, ...action.changes, expiresAt: action.changes.expiresAt ?? current.expiresAt };
        this.db.prepare(`UPDATE food_batches SET name = ?, category = ?, quantity = ?, unit = ?, purchased_at = ?, expires_at = ?, storage_location = ?, opened = ?, updated_at = ? WHERE id = ?`)
          .run(next.name, next.category, next.quantity, next.unit, next.purchasedAt, next.expiresAt, next.storageLocation, next.opened ? 1 : 0, timestamp, action.batchId);
        return [action.batchId];
      }
      case "consume_batch": {
        const current = this.requireBatch(action.batchId);
        if (action.quantity > current.quantity) throw new Error("消耗数量不能大于现有库存");
        this.db.prepare("UPDATE food_batches SET quantity = ?, updated_at = ? WHERE id = ?").run(current.quantity - action.quantity, timestamp, action.batchId);
        return [action.batchId];
      }
      case "soft_delete_batch":
        this.requireBatch(action.batchId);
        this.db.prepare("UPDATE food_batches SET deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, action.batchId);
        return [action.batchId];
    }
  }

  private describeHistoryAction(action: ProposalAction) {
    if (action.type === "add_batches") return `入库：${action.batches.map((batch) => `${batch.name} ${batch.quantity}${batch.unit}`).join("、")}`;
    const batch = this.findBatchIncludingDeleted(action.batchId);
    const name = batch?.name ?? "未知食材";
    if (action.type === "consume_batch") return `消耗：${name} ${action.quantity}${batch?.unit ?? ""}`;
    if (action.type === "soft_delete_batch") return `移除：${name}`;
    const changes = Object.entries(action.changes).map(([key, value]) => `${({ name: "名称", quantity: "数量", unit: "单位", purchasedAt: "购买日期", expiresAt: "过期日", storageLocation: "位置", opened: "开封状态", category: "类别" } as Record<string, string>)[key] ?? key} ${key === "opened" ? (value ? "已开封" : "未开封") : String(value)}`);
    return `修改：${name}${changes.length ? `（${changes.join("，")}）` : ""}`;
  }

  private findBatchIncludingDeleted(batchId: string) {
    return this.db.prepare("SELECT * FROM food_batches WHERE id = ? AND household_id = ?").get(batchId, this.householdId) as BatchRow | undefined;
  }

  private requireBatch(batchId: string): FoodBatch {
    const batch = this.getBatch(batchId);
    if (!batch) throw new Error("找不到可操作的库存批次");
    return batch;
  }
}

function normalizeAction(action: ProposalAction, store: InventoryStore): ProposalAction {
  if (action.type !== "add_batches") return action;
  return {
    ...action,
    batches: action.batches.map((batch) => ({
      ...batch,
      expiresAt: batch.expiresAt ?? resolveExpiresAt(batch, store),
    })),
  };
}

function resolveExpiresAt(batch: BatchInput, store: InventoryStore): string {
  const defaultDays = store.listFoodDefaultRules().find((rule) => rule.name === batch.name)?.shelfLifeDays ?? store.getCategoryDefault(batch.category);
  if (defaultDays === null) throw new Error(`未设置“${batch.category}”的默认有效期`);
  return addDays(batch.purchasedAt, defaultDays);
}

function toBatch(row: BatchRow): FoodBatch {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    purchasedAt: row.purchased_at,
    expiresAt: row.expires_at,
    storageLocation: row.storage_location,
    opened: Boolean(row.opened),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function openAppDatabase(): Database.Database {
  const configuredPath = process.env.FRIDGE_DATABASE_PATH;
  const dbPath = configuredPath ?? join(process.cwd(), "data", "fridge.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  return new Database(dbPath);
}

function createDefaultStore(): InventoryStore {
  return new InventoryStore(openAppDatabase());
}

const globalForStore = globalThis as unknown as { inventoryStore?: InventoryStore };

export function getInventoryStore(householdId = DEFAULT_HOUSEHOLD_ID): InventoryStore {
  if (!globalForStore.inventoryStore) globalForStore.inventoryStore = createDefaultStore();
  if (householdId === DEFAULT_HOUSEHOLD_ID) return globalForStore.inventoryStore;
  return new InventoryStore(openAppDatabase(), householdId);
}
