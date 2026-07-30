"use client";

import { useState } from "react";

import type { FoodPreferences } from "@/lib/preferences";
import type { MealRecommendations } from "@/lib/recipes";

export function MealRecommendations({ initialPreferences }: { initialPreferences: FoodPreferences }) {
  const [allergies, setAllergies] = useState(initialPreferences.allergies.join("、"));
  const [avoid, setAvoid] = useState(initialPreferences.avoidIngredients.join("、"));
  const [notes, setNotes] = useState(initialPreferences.dietaryNotes);
  const [results, setResults] = useState<MealRecommendations | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function savePreferences() {
    const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allergies: split(allergies), avoidIngredients: split(avoid), dietaryNotes: notes }) });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? "无法保存偏好");
  }

  async function recommend() {
    setBusy(true); setNotice("");
    try {
      await savePreferences();
      const response = await fetch("/api/recommendations", { method: "POST" });
      const data = (await response.json()) as { recommendations?: MealRecommendations; error?: string };
      if (!response.ok || !data.recommendations) throw new Error(data.error ?? "暂时无法推荐菜式");
      setResults(data.recommendations);
    } catch (error) { setNotice(error instanceof Error ? error.message : "暂时无法推荐菜式"); } finally { setBusy(false); }
  }

  return <section className="rounded-3xl bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">今天吃什么？</h2><p className="mt-1 text-sm text-slate-600">过敏和禁忌会先于库存匹配与临期优先级处理。</p><details className="mt-3 rounded-2xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">饮食偏好与禁忌</summary><div className="mt-3 grid gap-2 text-sm"><label className="grid gap-1">过敏食材（用顿号或逗号分隔）<input value={allergies} onChange={(event) => setAllergies(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2" placeholder="例如：花生、虾" /></label><label className="grid gap-1">不吃的食材<input value={avoid} onChange={(event) => setAvoid(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2" placeholder="例如：香菜" /></label><label className="grid gap-1">其他偏好<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-18 rounded-xl border border-slate-300 bg-white px-3 py-2" placeholder="例如：少油、晚餐 20 分钟内完成" /></label></div></details><button type="button" disabled={busy} onClick={recommend} className="mt-3 w-full rounded-xl bg-[#173f35] px-4 py-3 font-semibold text-white disabled:opacity-50">推荐至少三道菜</button>{notice && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm" role="status">{notice}</p>}{results && <div className="mt-3 grid gap-2">{results.dishes.map((dish) => <article key={dish.name} className="rounded-2xl bg-emerald-50 p-3"><p className="font-semibold">{dish.name}</p><p className="mt-1 text-sm">消耗库存：{dish.uses.map((use) => `${use.quantity}${use.unit}`).join("、")}</p><p className="mt-1 text-sm">缺少：{dish.missingIngredients.join("、") || "无"}</p><p className="mt-1 text-sm text-slate-600">{dish.reason}</p></article>)}</div>}</section>;
}

function split(value: string) { return value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean); }
