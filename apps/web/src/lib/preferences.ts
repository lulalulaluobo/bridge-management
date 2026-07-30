import "server-only";

import { z } from "zod";

import { openAppDatabase } from "@/lib/inventory/store";

const defaultHouseholdId = "default-household";
const preferenceSchema = z.object({
  allergies: z.array(z.string().trim().min(1).max(40)).max(30),
  avoidIngredients: z.array(z.string().trim().min(1).max(40)).max(30),
  dietaryNotes: z.string().trim().max(300),
});

export type FoodPreferences = z.infer<typeof preferenceSchema>;
export const emptyPreferences: FoodPreferences = { allergies: [], avoidIngredients: [], dietaryNotes: "" };

export class PreferenceStore {
  private readonly db = openAppDatabase();

  constructor(private readonly householdId = defaultHouseholdId) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS food_preferences (
      household_id TEXT PRIMARY KEY,
      allergies_json TEXT NOT NULL,
      avoid_json TEXT NOT NULL,
      dietary_notes TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  }

  get(): FoodPreferences {
    const row = this.db.prepare("SELECT allergies_json, avoid_json, dietary_notes FROM food_preferences WHERE household_id = ?").get(this.householdId) as { allergies_json: string; avoid_json: string; dietary_notes: string } | undefined;
    if (!row) return emptyPreferences;
    return preferenceSchema.parse({ allergies: JSON.parse(row.allergies_json), avoidIngredients: JSON.parse(row.avoid_json), dietaryNotes: row.dietary_notes });
  }

  save(input: unknown): FoodPreferences {
    const value = preferenceSchema.parse(input);
    const normalized = { ...value, allergies: unique(value.allergies), avoidIngredients: unique(value.avoidIngredients) };
    this.db.prepare(`INSERT INTO food_preferences (household_id, allergies_json, avoid_json, dietary_notes, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(household_id) DO UPDATE SET allergies_json = excluded.allergies_json, avoid_json = excluded.avoid_json, dietary_notes = excluded.dietary_notes, updated_at = excluded.updated_at`)
      .run(this.householdId, JSON.stringify(normalized.allergies), JSON.stringify(normalized.avoidIngredients), normalized.dietaryNotes, new Date().toISOString());
    return normalized;
  }
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const globalForPreferences = globalThis as unknown as { preferenceStore?: PreferenceStore };
export function getPreferenceStore(householdId = defaultHouseholdId) {
  if (householdId !== defaultHouseholdId) return new PreferenceStore(householdId);
  if (!globalForPreferences.preferenceStore) globalForPreferences.preferenceStore = new PreferenceStore();
  return globalForPreferences.preferenceStore;
}
