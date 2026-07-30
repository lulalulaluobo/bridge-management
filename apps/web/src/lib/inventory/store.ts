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

export class InventoryStore {
  constructor(private readonly db: Database.Database) {
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
        PRIMARY KEY (household_id, category)
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
    `);

    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO households (id, created_at) VALUES (?, ?)").run(DEFAULT_HOUSEHOLD_ID, now);
    const defaults: Array<[string, number]> = [["蔬菜", 4], ["水果", 7], ["乳制品", 7], ["肉类", 3], ["海鲜", 2], ["主食", 30], ["饮料", 14], ["其他", 7]];
    const insert = this.db.prepare("INSERT OR IGNORE INTO category_defaults (household_id, category, shelf_life_days) VALUES (?, ?, ?)");
    for (const [category, days] of defaults) insert.run(DEFAULT_HOUSEHOLD_ID, category, days);
  }

  setCategoryDefault(category: FoodBatch["category"], shelfLifeDays: number) {
    this.db.prepare(`INSERT INTO category_defaults (household_id, category, shelf_life_days) VALUES (?, ?, ?)
      ON CONFLICT(household_id, category) DO UPDATE SET shelf_life_days = excluded.shelf_life_days`).run(DEFAULT_HOUSEHOLD_ID, category, shelfLifeDays);
  }

  getCategoryDefault(category: FoodBatch["category"]): number | null {
    const row = this.db.prepare("SELECT shelf_life_days FROM category_defaults WHERE household_id = ? AND category = ?").get(DEFAULT_HOUSEHOLD_ID, category) as { shelf_life_days: number } | undefined;
    return row?.shelf_life_days ?? null;
  }

  listBatches(today = todayInShanghai()): FoodBatchWithStatus[] {
    const rows = this.db.prepare(`SELECT * FROM food_batches WHERE household_id = ? AND deleted_at IS NULL AND quantity > 0
      ORDER BY expires_at ASC, created_at DESC`).all(DEFAULT_HOUSEHOLD_ID) as BatchRow[];
    return rows.map((row) => ({ ...toBatch(row), status: statusForExpiration(row.expires_at, today) }));
  }

  getBatch(batchId: string): FoodBatch | null {
    const row = this.db.prepare("SELECT * FROM food_batches WHERE id = ? AND household_id = ? AND deleted_at IS NULL").get(batchId, DEFAULT_HOUSEHOLD_ID) as BatchRow | undefined;
    return row ? toBatch(row) : null;
  }

  createProposal(action: ProposalAction, now = new Date()): OperationProposal {
    const normalized = normalizeAction(action, this);
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString();
    this.db.prepare("INSERT INTO operation_proposals (id, household_id, action_json, state, expires_at, created_at) VALUES (?, ?, ?, 'pending', ?, ?)")
      .run(id, DEFAULT_HOUSEHOLD_ID, JSON.stringify(normalized), expiresAt, now.toISOString());
    return { id, action: normalized, expiresAt };
  }

  confirmProposal(proposalId: string, idempotencyKey: string, now = new Date()): ConfirmedWrite {
    if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("无效的幂等键");
    const existing = this.db.prepare("SELECT result_json FROM write_requests WHERE idempotency_key = ?").get(idempotencyKey) as { result_json: string } | undefined;
    if (existing) return { ...(JSON.parse(existing.result_json) as ConfirmedWrite), idempotent: true };

    const run = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM operation_proposals WHERE id = ? AND household_id = ?").get(proposalId, DEFAULT_HOUSEHOLD_ID) as ProposalRow | undefined;
      if (!row) throw new Error("找不到待确认操作");
      if (new Date(row.expires_at) < now) throw new Error("此操作已过期，请重新确认");
      const state = this.db.prepare("SELECT state FROM operation_proposals WHERE id = ?").get(proposalId) as { state: string };
      if (state.state !== "pending") throw new Error("此操作已处理，请刷新后查看库存");
      const action = proposalActionSchema.parse(JSON.parse(row.action_json));
      const changedBatchIds = this.applyAction(action, now.toISOString());
      const result: ConfirmedWrite = { proposalId, action, changedBatchIds, idempotent: false };
      this.db.prepare("UPDATE operation_proposals SET state = 'confirmed', confirmed_at = ? WHERE id = ?").run(now.toISOString(), proposalId);
      this.db.prepare("INSERT INTO write_requests (idempotency_key, proposal_id, result_json, created_at) VALUES (?, ?, ?, ?)")
        .run(idempotencyKey, proposalId, JSON.stringify(result), now.toISOString());
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
          insert.run(id, DEFAULT_HOUSEHOLD_ID, batch.name, batch.category, batch.quantity, batch.unit, batch.purchasedAt, batch.expiresAt, batch.storageLocation, batch.opened ? 1 : 0, timestamp, timestamp);
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
  const defaultDays = store.getCategoryDefault(batch.category);
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

function createDefaultStore(): InventoryStore {
  const configuredPath = process.env.FRIDGE_DATABASE_PATH;
  const dbPath = configuredPath ?? join(process.cwd(), "data", "fridge.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  return new InventoryStore(new Database(dbPath));
}

const globalForStore = globalThis as unknown as { inventoryStore?: InventoryStore };

export function getInventoryStore(): InventoryStore {
  if (!globalForStore.inventoryStore) globalForStore.inventoryStore = createDefaultStore();
  return globalForStore.inventoryStore;
}
