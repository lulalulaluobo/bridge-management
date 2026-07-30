import "server-only";

import Database from "better-sqlite3";

import { openAppDatabase } from "@/lib/inventory/store";

const defaultHouseholdId = "default-household";
export type AgentSettings = { naturalLanguageAutoSave: boolean };

export class AgentSettingsStore {
  private readonly db: Database.Database = openAppDatabase();

  constructor(private readonly householdId = defaultHouseholdId) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS agent_settings (
      household_id TEXT PRIMARY KEY,
      natural_language_auto_save INTEGER NOT NULL DEFAULT 1 CHECK (natural_language_auto_save IN (0, 1)),
      updated_at TEXT NOT NULL
    )`);
  }

  get(): AgentSettings {
    const row = this.db.prepare("SELECT natural_language_auto_save FROM agent_settings WHERE household_id = ?").get(this.householdId) as { natural_language_auto_save: number } | undefined;
    return { naturalLanguageAutoSave: row ? Boolean(row.natural_language_auto_save) : true };
  }

  save(naturalLanguageAutoSave: boolean): AgentSettings {
    this.db.prepare(`INSERT INTO agent_settings (household_id, natural_language_auto_save, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(household_id) DO UPDATE SET natural_language_auto_save = excluded.natural_language_auto_save, updated_at = excluded.updated_at`)
      .run(this.householdId, naturalLanguageAutoSave ? 1 : 0, new Date().toISOString());
    return { naturalLanguageAutoSave };
  }
}

const globalForAgentSettings = globalThis as unknown as { agentSettingsStore?: AgentSettingsStore };
export function getAgentSettingsStore(householdId = defaultHouseholdId) {
  if (householdId !== defaultHouseholdId) return new AgentSettingsStore(householdId);
  if (!globalForAgentSettings.agentSettingsStore) globalForAgentSettings.agentSettingsStore = new AgentSettingsStore();
  return globalForAgentSettings.agentSettingsStore;
}
