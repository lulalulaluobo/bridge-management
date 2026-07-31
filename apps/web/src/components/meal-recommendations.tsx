"use client";

import { useEffect, useState } from "react";

import type { FoodPreferences } from "@/lib/preferences";
import type { MealDish, MealRecommendations } from "@/lib/recipes";

const RECOMMENDATIONS_STORAGE_KEY = "fridge_latest_meal_recommendations";
const EXCLUDE_STORAGE_KEY = "fridge_meal_exclude_dishes";

// 本地自然日(Asia/Shanghai),用于排除列表按自然日过期重置。
// 不能用 toISOString()(UTC),否则 UTC+8 用户午夜后仍有 8 小时残留。
function todayLocalKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function getExcludeDishes(): string[] {
  try {
    const cached = localStorage.getItem(EXCLUDE_STORAGE_KEY);
    if (!cached) return [];
    const parsed = JSON.parse(cached) as { date: string; dishes: string[] };
    if (parsed.date === todayLocalKey()) {
      return parsed.dishes;
    }
  } catch {
    // Ignore
  }
  return [];
}

function saveExcludeDishes(dishes: string[]) {
  try {
    localStorage.setItem(EXCLUDE_STORAGE_KEY, JSON.stringify({ date: todayLocalKey(), dishes }));
  } catch {
    // Ignore
  }
}

function clearExcludeDishes() {
  try {
    localStorage.removeItem(EXCLUDE_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function MealRecommendations({ initialPreferences }: { initialPreferences: FoodPreferences }) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [results, setResults] = useState<MealRecommendations | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [mealTime, setMealTime] = useState<string>("晚餐");
  const [diners, setDiners] = useState<string>("2人");
  const [extraConditions, setExtraConditions] = useState<string>("");

  const [favoritesMap, setFavoritesMap] = useState<Record<string, boolean>>({});
  const [selectedRecipe, setSelectedRecipe] = useState<MealDish | null>(null);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(RECOMMENDATIONS_STORAGE_KEY);
      if (cached) setResults(JSON.parse(cached));
    } catch {
      // Ignore
    }
    void loadFavorites();
  }, []);

  async function loadFavorites() {
    try {
      const res = await fetch("/api/favorites");
      const data = (await res.json()) as { favorites?: Array<{ name: string; recipeId: string }> };
      if (data.favorites) {
        const map: Record<string, boolean> = {};
        for (const item of data.favorites) {
          if (item.recipeId) map[item.recipeId] = true;
          if (item.name) map[item.name] = true;
        }
        setFavoritesMap(map);
      }
    } catch {
      // Ignore
    }
  }

  async function recommend() {
    clearExcludeDishes();
    setBusy(true);
    setNotice("");
    try {
      const saved = await savePreferences(preferences);
      setPreferences(saved);
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealTime, diners, extraConditions }),
      });
      const data = (await response.json()) as { recommendations?: MealRecommendations; error?: string };
      if (!response.ok || !data.recommendations) throw new Error(data.error ?? "暂时无法推荐菜式");
      setResults(data.recommendations);
      try {
        localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, JSON.stringify(data.recommendations));
      } catch {
        // Ignore
      }
      await loadFavorites();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法推荐菜式");
    } finally {
      setBusy(false);
    }
  }

  async function recommendMore() {
    setBusy(true);
    setNotice("");
    try {
      const currentDishNames = results?.dishes.map((dish) => dish.name) ?? [];
      const existingExcluded = getExcludeDishes();
      const newExcluded = Array.from(new Set([...existingExcluded, ...currentDishNames]));
      saveExcludeDishes(newExcluded);

      const saved = await savePreferences(preferences);
      setPreferences(saved);
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mealTime, diners, extraConditions, excludeDishes: newExcluded }),
      });
      const data = (await response.json()) as { recommendations?: MealRecommendations; error?: string };
      if (!response.ok || !data.recommendations) throw new Error(data.error ?? "暂时无法推荐菜式");
      setResults(data.recommendations);
      try {
        localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, JSON.stringify(data.recommendations));
      } catch {
        // Ignore
      }
      await loadFavorites();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法推荐菜式");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(dish: MealDish) {
    const key = dish.recipeId || dish.name;
    const isSaved = Boolean(favoritesMap[key]);

    try {
      if (isSaved) {
        await fetch(`/api/favorites?id=${encodeURIComponent(key)}`, { method: "DELETE" });
        setFavoritesMap((prev) => ({ ...prev, [key]: false, [dish.name]: false }));
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipeId: dish.recipeId || "",
            name: dish.name,
            cover: dish.cover || "",
            score: dish.score || "",
            cooked: dish.cooked || "",
            reason: dish.reason || "",
            ingredients: dish.availableIngredients?.map((item) => ({ name: item.name, unit: item.unit, inStock: true })) || [],
            steps: dish.steps || [],
            tips: dish.tips || "",
          }),
        });
        setFavoritesMap((prev) => ({ ...prev, [key]: true, [dish.name]: true }));
      }
    } catch {
      setNotice("操作失败，请重试");
    }
  }

  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-[#173f35]">今天吃什么？</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">优先临期和已开封食材；开源家常菜谱，指导你看着页面做饭。</p>

      {/* 就战与餐次选项 */}
      <div className="mt-3 rounded-2xl bg-[#f5f7f4] p-3 text-sm">
        <label className="block text-xs font-semibold text-[#506359]">用餐时间段</label>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {["早餐", "午餐", "晚餐", "夜宵"].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMealTime(item)}
              className={`rounded-xl py-1.5 text-xs font-medium transition ${
                mealTime === item ? "bg-[#173f35] text-white shadow-sm" : "bg-white text-[#405148]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-semibold text-[#506359]">就餐人数</label>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {["1人", "2人", "3-4人", "5人以上"].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDiners(item)}
              className={`rounded-xl py-1.5 text-xs font-medium transition ${
                diners === item ? "bg-[#173f35] text-white shadow-sm" : "bg-white text-[#405148]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-semibold text-[#506359]">额外条件 / 特别想吃</label>
        <input
          value={extraConditions}
          onChange={(event) => setExtraConditions(event.target.value)}
          placeholder="例如：想吃辣、清淡少油、快速搞定"
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-[#25332d] outline-none focus:border-[#173f35]"
        />
      </div>

      <details className="mt-3 rounded-2xl bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">▼ 饮食与做菜条件设置</summary>
        <PreferenceFields value={preferences} onChange={setPreferences} />
        <button
          type="button"
          onClick={async () => {
            try {
              setPreferences(await savePreferences(preferences));
              setNotice("已保存做菜条件");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "无法保存偏好");
            }
          }}
          className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#173f35] shadow-sm border border-slate-200"
        >
          保存条件
        </button>
      </details>

      <button
        type="button"
        disabled={busy}
        onClick={recommend}
        className="mt-4 w-full rounded-2xl bg-[#173f35] px-4 py-3.5 text-sm font-bold text-white shadow-md active:scale-95 disabled:opacity-50"
      >
        {busy ? "正在分析库存与开源菜谱…" : "推荐菜谱方案"}
      </button>

      {notice && (
        <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700" role="status">
          {notice}
        </p>
      )}

      {results && (
        <>
          <MealRecommendationCards
            recommendations={results}
            favoritesMap={favoritesMap}
            onToggleFavorite={toggleFavorite}
            onSelectRecipe={setSelectedRecipe}
          />
          <button
            type="button"
            disabled={busy}
            onClick={recommendMore}
            className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-emerald-600 bg-white py-3 text-xs font-bold text-emerald-800 shadow-sm transition hover:bg-emerald-50 active:scale-98 disabled:opacity-50"
          >
            🔄 不合口味，换一批菜谱
          </button>
        </>
      )}

      {selectedRecipe && <CookingModal recipe={selectedRecipe} onClose={() => setSelectedRecipe(null)} />}
    </section>
  );
}

export function MealRecommendationCards({
  recommendations,
  favoritesMap = {},
  onToggleFavorite,
  onSelectRecipe,
}: {
  recommendations: MealRecommendations;
  favoritesMap?: Record<string, boolean>;
  onToggleFavorite?: (dish: MealDish) => void;
  onSelectRecipe?: (dish: MealDish) => void;
}) {
  return (
    <div className="mt-4 grid gap-3">
      {recommendations.dishes.map((dish) => {
        const key = dish.recipeId || dish.name;
        const isSaved = Boolean(favoritesMap[key] || favoritesMap[dish.name]);

        return (
          <article key={dish.name} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
            {dish.cover && (
              <div className="relative h-40 w-full overflow-hidden bg-slate-100">
                {/* eslint-disable-next-html-element-suppression */}
                <img src={dish.cover} alt={dish.name} className="h-full w-full object-cover" />
                {dish.score && (
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
                    难度 {dish.score}
                  </span>
                )}
                {dish.cooked && (
                  <span className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
                    🔥 {dish.cooked}
                  </span>
                )}
              </div>
            )}

            <div className="p-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-bold text-[#173f35]">{dish.name}</h3>
                {onToggleFavorite && (
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(dish)}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                      isSaved ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <span>{isSaved ? "★" : "☆"}</span>
                    <span>{isSaved ? "已收藏" : "收藏"}</span>
                  </button>
                )}
              </div>

              <ReadinessLine
                label="库存已有"
                values={dish.availableIngredients?.map((item) => `${item.name}${item.quantity}${item.unit}`) ?? []}
                tone="text-emerald-800"
              />
              <ReadinessLine
                label="可替代"
                values={dish.substitutions.flatMap((item) => item.alternatives.map((alternative) => `${item.ingredient} → ${alternative}`))}
                tone="text-sky-800"
                empty="无"
              />
              <ReadinessLine label="确实缺少" values={dish.missingIngredients} tone="text-amber-900" empty="无" />

              <p className="mt-2 text-xs leading-5 text-slate-600">{dish.reason}</p>

              {dish.steps && dish.steps.length > 0 && onSelectRecipe && (
                <button
                  type="button"
                  onClick={() => onSelectRecipe(dish)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#173f35]/10 py-2.5 text-xs font-bold text-[#173f35] transition hover:bg-[#173f35]/20 active:scale-98"
                >
                  📖 查看烹饪步骤与图片 ({dish.steps.length} 步)
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ReadinessLine({ label, values, tone, empty = "—" }: { label: string; values: string[]; tone: string; empty?: string }) {
  return (
    <p className={`mt-1 text-xs ${tone}`}>
      <span className="font-semibold">{label}：</span>
      {values.join("、") || empty}
    </p>
  );
}

function PreferenceFields({ value, onChange }: { value: FoodPreferences; onChange: (value: FoodPreferences) => void }) {
  return (
    <div className="mt-3 grid gap-2 text-xs">
      <TextField
        label="过敏食材"
        value={value.allergies.join("、")}
        placeholder="例如：花生、虾"
        onChange={(allergies) => onChange({ ...value, allergies: split(allergies) })}
      />
      <TextField
        label="不吃的食材"
        value={value.avoidIngredients.join("、")}
        placeholder="例如：香菜"
        onChange={(avoidIngredients) => onChange({ ...value, avoidIngredients: split(avoidIngredients) })}
      />
      <TextField
        label="可用厨具"
        value={value.appliances.join("、")}
        placeholder="例如：空气炸锅、电饭煲"
        onChange={(appliances) => onChange({ ...value, appliances: split(appliances) })}
      />
      <TextField
        label="常备调料"
        value={value.staples.join("、")}
        placeholder="例如：盐、油、生抽"
        onChange={(staples) => onChange({ ...value, staples: split(staples) })}
      />
      <label className="grid gap-1 font-medium text-slate-700">
        其他偏好
        <textarea
          value={value.dietaryNotes}
          onChange={(event) => onChange({ ...value, dietaryNotes: event.target.value })}
          className="min-h-14 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none"
          placeholder="例如：少油、晚餐"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 font-medium text-slate-700">
          最大用时 (分钟)
          <input
            type="number"
            min="5"
            max="360"
            value={value.maxCookingMinutes}
            onChange={(event) => onChange({ ...value, maxCookingMinutes: Number(event.target.value) || 30 })}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none"
          />
        </label>
        <label className="grid gap-1 font-medium text-slate-700">
          烹饪水平
          <select
            value={value.cookingSkill}
            onChange={(event) => onChange({ ...value, cookingSkill: event.target.value as FoodPreferences["cookingSkill"] })}
            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none"
          >
            <option>随意</option>
            <option>新手</option>
            <option>熟练</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 font-medium text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none"
        placeholder={placeholder}
      />
    </label>
  );
}

async function savePreferences(preferences: FoodPreferences) {
  const response = await fetch("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
  const data = (await response.json()) as { preferences?: FoodPreferences; error?: string };
  if (!response.ok || !data.preferences) throw new Error(data.error ?? "无法保存偏好");
  return data.preferences;
}

function split(value: string) {
  return value
    .split(/[，,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function CookingModal({
  recipe,
  onClose,
}: {
  recipe: {
    name: string;
    cover?: string;
    score?: string;
    cooked?: string;
    ingredients?: Array<{ name: string; unit: string; inStock?: boolean }>;
    steps?: Array<{ step: number; desc: string; img?: string }>;
    tips?: string;
  };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f3f4f0] pb-32 text-[#17231f]">
      {/* Floating Bottom-Left Return Button for ergonomic one-handed operation */}
      <button
        type="button"
        onClick={onClose}
        className="fixed bottom-24 left-4 z-50 flex items-center gap-2 rounded-full border border-white/40 bg-[#173f35]/90 px-4 py-2.5 text-xs font-bold text-white shadow-[0_8px_24px_rgba(23,63,53,.35)] backdrop-blur-xl transition active:scale-95"
      >
        <span className="text-sm font-black">←</span>
        <span>返回</span>
      </button>

      <div className="mx-auto w-full max-w-xl">
        {/* Header photo & title */}
        <div className="relative h-60 w-full bg-slate-800">
          {recipe.cover ? (
            <img src={recipe.cover} alt={recipe.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#173f35] text-3xl font-bold text-white">
              {recipe.name}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

          <div className="absolute bottom-4 left-5 right-5">
            <h2 className="text-2xl font-bold text-white tracking-tight">{recipe.name}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-amber-300">
              {recipe.score && <span>难度 {recipe.score}</span>}
              {recipe.cooked && <span>· 🔥 {recipe.cooked}</span>}
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5">
          {/* Ingredients */}
          {recipe.ingredients && recipe.ingredients.length > 0 && (
            <section className="mb-6 rounded-3xl bg-white p-5 shadow-[0_3px_14px_rgba(23,63,53,.05)]">
              <h3 className="text-base font-bold text-[#173f35]">🥗 用料清单</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {recipe.ingredients.map((ing, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-xl bg-[#f7f8f5] px-3.5 py-2.5">
                    <span className="font-semibold text-slate-800">{ing.name}</span>
                    <span className="text-slate-500">{ing.unit}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Steps */}
          {recipe.steps && recipe.steps.length > 0 ? (
            <section className="mb-6">
              <h3 className="mb-3 px-1 text-base font-bold text-[#173f35]">🍳 烹饪步骤</h3>
              <div className="grid gap-4">
                {recipe.steps.map((step) => (
                  <div key={step.step} className="rounded-3xl border border-white/80 bg-white p-4 shadow-[0_3px_14px_rgba(23,63,53,.05)]">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#173f35] text-xs font-bold text-white">
                        {step.step}
                      </span>
                      <span className="text-xs font-bold text-slate-600">步骤 {step.step}</span>
                    </div>

                    <p className="mt-3 text-sm leading-6 font-medium text-slate-800 whitespace-pre-line">{step.desc}</p>

                    {step.img && (
                      <div className="mt-3.5 overflow-hidden rounded-2xl bg-slate-100">
                        <img src={step.img} alt={`步骤 ${step.step}`} className="max-h-72 w-full object-cover" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <p className="text-center text-xs text-slate-500">暂无步骤图解。</p>
          )}

          {/* Tips */}
          {recipe.tips && (
            <section className="rounded-2xl bg-amber-50/80 p-3.5 text-xs text-amber-900">
              <h4 className="font-bold">💡 烹饪小贴士</h4>
              <p className="mt-1 leading-5 whitespace-pre-line">{recipe.tips}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
