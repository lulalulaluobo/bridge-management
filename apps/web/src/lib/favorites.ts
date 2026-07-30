import "server-only";

import { randomUUID } from "node:crypto";

import { openAppDatabase } from "@/lib/inventory/store";

export type SavedRecipeIngredient = {
  name: string;
  unit: string;
  inStock?: boolean;
};

export type SavedRecipeStep = {
  step: number;
  desc: string;
  img?: string;
};

export type SavedRecipe = {
  id: string;
  householdId: string;
  recipeId: string;
  name: string;
  cover: string;
  score: string;
  cooked: string;
  reason: string;
  ingredients: SavedRecipeIngredient[];
  steps: SavedRecipeStep[];
  tips: string;
  createdAt: string;
};

export class FavoritesStore {
  private readonly db = openAppDatabase();

  constructor(private readonly householdId = "default-household") {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saved_recipes (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        recipe_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cover TEXT,
        score TEXT,
        cooked TEXT,
        reason TEXT,
        ingredients_json TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        tips TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (household_id, recipe_id)
      );
      CREATE INDEX IF NOT EXISTS saved_recipes_lookup ON saved_recipes (household_id, created_at DESC);
    `);
  }

  list(): SavedRecipe[] {
    const rows = this.db
      .prepare(
        "SELECT id, household_id, recipe_id, name, cover, score, cooked, reason, ingredients_json, steps_json, tips, created_at FROM saved_recipes WHERE household_id = ? ORDER BY created_at DESC"
      )
      .all(this.householdId) as Array<{
      id: string;
      household_id: string;
      recipe_id: string;
      name: string;
      cover: string | null;
      score: string | null;
      cooked: string | null;
      reason: string | null;
      ingredients_json: string;
      steps_json: string;
      tips: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      householdId: row.household_id,
      recipeId: row.recipe_id,
      name: row.name,
      cover: row.cover ?? "",
      score: row.score ?? "",
      cooked: row.cooked ?? "",
      reason: row.reason ?? "",
      ingredients: JSON.parse(row.ingredients_json) as SavedRecipeIngredient[],
      steps: JSON.parse(row.steps_json) as SavedRecipeStep[],
      tips: row.tips ?? "",
      createdAt: row.created_at,
    }));
  }

  save(item: Omit<SavedRecipe, "id" | "householdId" | "createdAt">): SavedRecipe {
    const now = new Date().toISOString();
    const recipeId = item.recipeId || randomUUID();
    const existing = this.db
      .prepare("SELECT id FROM saved_recipes WHERE household_id = ? AND recipe_id = ?")
      .get(this.householdId, recipeId) as { id: string } | undefined;

    const id = existing?.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO saved_recipes
          (id, household_id, recipe_id, name, cover, score, cooked, reason, ingredients_json, steps_json, tips, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(household_id, recipe_id) DO UPDATE SET
            name = excluded.name, cover = excluded.cover, score = excluded.score, cooked = excluded.cooked,
            reason = excluded.reason, ingredients_json = excluded.ingredients_json,
            steps_json = excluded.steps_json, tips = excluded.tips`
      )
      .run(
        id,
        this.householdId,
        recipeId,
        item.name,
        item.cover,
        item.score,
        item.cooked,
        item.reason,
        JSON.stringify(item.ingredients),
        JSON.stringify(item.steps),
        item.tips,
        now
      );

    return {
      id,
      householdId: this.householdId,
      recipeId,
      name: item.name,
      cover: item.cover,
      score: item.score,
      cooked: item.cooked,
      reason: item.reason,
      ingredients: item.ingredients,
      steps: item.steps,
      tips: item.tips,
      createdAt: now,
    };
  }

  delete(recipeIdOrId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM saved_recipes WHERE household_id = ? AND (id = ? OR recipe_id = ?)")
      .run(this.householdId, recipeIdOrId, recipeIdOrId);
    return result.changes > 0;
  }

  isSaved(recipeIdOrName: string): boolean {
    const row = this.db
      .prepare("SELECT id FROM saved_recipes WHERE household_id = ? AND (recipe_id = ? OR name = ?)")
      .get(this.householdId, recipeIdOrName, recipeIdOrName);
    return Boolean(row);
  }
}

const globalForFavoritesStore = globalThis as unknown as { favoritesStore?: FavoritesStore };

export function getFavoritesStore(householdId = "default-household") {
  if (householdId !== "default-household") return new FavoritesStore(householdId);
  if (!globalForFavoritesStore.favoritesStore) globalForFavoritesStore.favoritesStore = new FavoritesStore();
  return globalForFavoritesStore.favoritesStore;
}
