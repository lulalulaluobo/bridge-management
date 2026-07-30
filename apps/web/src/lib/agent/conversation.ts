import "server-only";

import { randomUUID } from "node:crypto";

import { openAppDatabase } from "@/lib/inventory/store";
import type { ProposalAction } from "@/lib/inventory/types";

export type ConversationStatus = "pending" | "committed";
export type ConversationMessage = { id: string; role: "user" | "assistant"; content: string; status: ConversationStatus; createdAt: string };

const defaultHouseholdId = "default-household";

export class ConversationStore {
  private readonly db = openAppDatabase();

  constructor(private readonly householdId = defaultHouseholdId) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS agent_conversation_messages (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'committed')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_conversation_messages_lookup ON agent_conversation_messages (household_id, conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS agent_conversation_writes (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      action_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_conversation_writes_lookup ON agent_conversation_writes (household_id, conversation_id, created_at);`);
  }

  append(conversationId: string, role: ConversationMessage["role"], content: string, status: ConversationStatus = "pending") {
    const message: ConversationMessage = { id: randomUUID(), role, content, status, createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO agent_conversation_messages (id, household_id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(message.id, this.householdId, conversationId, message.role, message.content, message.status, message.createdAt);
    return message;
  }

  history(conversationId: string) {
    const rows = this.db.prepare("SELECT id, role, content, status, created_at FROM agent_conversation_messages WHERE household_id = ? AND conversation_id = ? ORDER BY created_at ASC").all(this.householdId, conversationId) as Array<{ id: string; role: ConversationMessage["role"]; content: string; status: ConversationStatus; created_at: string }>;
    return rows.map((row) => ({ id: row.id, role: row.role, content: row.content, status: row.status, createdAt: row.created_at }));
  }

  markPendingCommitted(conversationId: string, proposalId: string, action: ProposalAction) {
    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      this.db.prepare("UPDATE agent_conversation_messages SET status = 'committed' WHERE household_id = ? AND conversation_id = ? AND status = 'pending'").run(this.householdId, conversationId);
      this.db.prepare("INSERT OR IGNORE INTO agent_conversation_writes (id, household_id, conversation_id, proposal_id, action_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), this.householdId, conversationId, proposalId, JSON.stringify(action), now);
    });
    run();
  }

  summary(conversationId: string) {
    const messages = this.history(conversationId);
    const rows = this.db.prepare("SELECT action_json FROM agent_conversation_writes WHERE household_id = ? AND conversation_id = ? ORDER BY created_at ASC").all(this.householdId, conversationId) as Array<{ action_json: string }>;
    const names = rows.flatMap((row) => {
      const action = JSON.parse(row.action_json) as ProposalAction;
      return action.type === "add_batches" ? action.batches.map((batch) => `${batch.name}${batch.quantity}${batch.unit}`) : [];
    });
    return { userTurns: messages.filter((message) => message.role === "user").length, names };
  }
}

const globalForConversations = globalThis as unknown as { conversationStore?: ConversationStore };
export function getConversationStore(householdId = defaultHouseholdId) {
  if (householdId !== defaultHouseholdId) return new ConversationStore(householdId);
  if (!globalForConversations.conversationStore) globalForConversations.conversationStore = new ConversationStore();
  return globalForConversations.conversationStore;
}
