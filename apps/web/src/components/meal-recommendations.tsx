"use client";

import { useState } from "react";

import type { FoodPreferences } from "@/lib/preferences";
import type { MealRecommendations } from "@/lib/recipes";

export function MealRecommendations({ initialPreferences }: { initialPreferences: FoodPreferences }) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [results, setResults] = useState<MealRecommendations | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function recommend() {
    setBusy(true); setNotice("");
    try {
      const saved = await savePreferences(preferences);
      setPreferences(saved);
      const response = await fetch("/api/recommendations", { method: "POST" });
      const data = (await response.json()) as { recommendations?: MealRecommendations; error?: string };
      if (!response.ok || !data.recommendations) throw new Error(data.error ?? "暂时无法推荐菜式");
      setResults(data.recommendations);
    } catch (error) { setNotice(error instanceof Error ? error.message : "暂时无法推荐菜式"); } finally { setBusy(false); }
  }

  return <section className="rounded-3xl bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">今天吃什么？</h2><p className="mt-1 text-sm text-slate-600">优先临期和已开封食材；过敏与禁忌始终优先。</p><details className="mt-3 rounded-2xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">饮食与做菜条件</summary><PreferenceFields value={preferences} onChange={setPreferences} /><button type="button" onClick={async () => { try { setPreferences(await savePreferences(preferences)); setNotice("已保存做菜条件"); } catch (error) { setNotice(error instanceof Error ? error.message : "无法保存偏好"); } }} className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#173f35] shadow-sm">保存条件</button></details><button type="button" disabled={busy} onClick={recommend} className="mt-3 w-full rounded-xl bg-[#173f35] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "正在搭配…" : "推荐至少三道菜"}</button>{notice && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm" role="status">{notice}</p>}{results && <MealRecommendationCards recommendations={results} />}</section>;
}

export function MealRecommendationCards({ recommendations }: { recommendations: MealRecommendations }) {
  return <div className="mt-3 grid gap-2">{recommendations.dishes.map((dish) => <article key={dish.name} className="rounded-2xl bg-emerald-50 p-3"><p className="font-semibold">{dish.name}</p><ReadinessLine label="库存已有" values={dish.availableIngredients?.map((item) => `${item.name}${item.quantity}${item.unit}${item.source === "照片候选" ? "（照片）" : ""}`) ?? dish.uses.map((item) => `${item.quantity}${item.unit}`)} tone="text-emerald-800" /><ReadinessLine label="可替代" values={dish.substitutions.flatMap((item) => item.alternatives.map((alternative) => `${item.ingredient} → ${alternative}`))} tone="text-sky-800" empty="无" /><ReadinessLine label="确实缺少" values={dish.missingIngredients} tone="text-amber-900" empty="无" /><p className="mt-2 text-sm leading-5 text-slate-600">{dish.reason}</p></article>)}</div>;
}

function ReadinessLine({ label, values, tone, empty = "—" }: { label: string; values: string[]; tone: string; empty?: string }) { return <p className={`mt-1 text-sm ${tone}`}><span className="font-semibold">{label}：</span>{values.join("、") || empty}</p>; }

function PreferenceFields({ value, onChange }: { value: FoodPreferences; onChange: (value: FoodPreferences) => void }) {
  return <div className="mt-3 grid gap-2 text-sm"><TextField label="过敏食材" value={value.allergies.join("、")} placeholder="例如：花生、虾" onChange={(allergies) => onChange({ ...value, allergies: split(allergies) })} /><TextField label="不吃的食材" value={value.avoidIngredients.join("、")} placeholder="例如：香菜" onChange={(avoidIngredients) => onChange({ ...value, avoidIngredients: split(avoidIngredients) })} /><TextField label="可用厨具" value={value.appliances.join("、")} placeholder="例如：空气炸锅、电饭煲" onChange={(appliances) => onChange({ ...value, appliances: split(appliances) })} /><TextField label="常备调料" value={value.staples.join("、")} placeholder="例如：盐、油、生抽" onChange={(staples) => onChange({ ...value, staples: split(staples) })} /><label className="grid gap-1">其他偏好<textarea value={value.dietaryNotes} onChange={(event) => onChange({ ...value, dietaryNotes: event.target.value })} className="min-h-16 rounded-xl border border-slate-300 bg-white px-3 py-2" placeholder="例如：少油、晚餐" /></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1">最大用时<input type="number" min="5" max="360" value={value.maxCookingMinutes} onChange={(event) => onChange({ ...value, maxCookingMinutes: Number(event.target.value) || 30 })} className="rounded-xl border border-slate-300 bg-white px-3 py-2" /></label><label className="grid gap-1">烹饪水平<select value={value.cookingSkill} onChange={(event) => onChange({ ...value, cookingSkill: event.target.value as FoodPreferences["cookingSkill"] })} className="rounded-xl border border-slate-300 bg-white px-3 py-2"><option>随意</option><option>新手</option><option>熟练</option></select></label></div></div>;
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) { return <label className="grid gap-1">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2" placeholder={placeholder} /></label>; }

async function savePreferences(preferences: FoodPreferences) {
  const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences) });
  const data = (await response.json()) as { preferences?: FoodPreferences; error?: string };
  if (!response.ok || !data.preferences) throw new Error(data.error ?? "无法保存偏好");
  return data.preferences;
}

function split(value: string) { return value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean); }
