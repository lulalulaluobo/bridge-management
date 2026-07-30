"use client";

import { useEffect, useState } from "react";

import { CookingModal } from "@/components/meal-recommendations";
import type { SavedRecipe } from "@/lib/favorites";

export function FavoritesView() {
  const [recipes, setRecipes] = useState<SavedRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecipe, setSelectedRecipe] = useState<SavedRecipe | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void loadFavorites();
  }, []);

  async function loadFavorites() {
    setLoading(true);
    try {
      const res = await fetch("/api/favorites");
      const data = (await res.json()) as { favorites?: SavedRecipe[] };
      if (data.favorites) {
        setRecipes(data.favorites);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }

  async function removeFavorite(id: string, name: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!window.confirm(`确定取消收藏“${name}”吗？`)) return;
    try {
      await fetch(`/api/favorites?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setRecipes((prev) => prev.filter((r) => r.id !== id && r.recipeId !== id));
    } catch {
      alert("取消收藏失败");
    }
  }

  const filtered = recipes.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <section className="mt-7">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[25px] font-bold tracking-[-.04em] text-[#17231f]">收藏菜谱</h2>
          <p className="mt-1 text-sm text-[#6f8178]">{recipes.length} 道已收藏菜谱 · 照着页面轻松做饭</p>
        </div>
      </div>

      {recipes.length > 0 && (
        <div className="mt-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索已收藏菜谱..."
            className="w-full rounded-2xl border border-white/80 bg-white/90 px-4 py-2.5 text-sm outline-none shadow-sm backdrop-blur-xl"
          />
        </div>
      )}

      {loading ? (
        <div className="mt-8 text-center text-sm text-[#6f8178]">加载收藏列表中…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-10 rounded-3xl bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">🍳</p>
          <h3 className="mt-3 text-base font-bold text-[#173f35]">
            {search ? "没有找到相关菜谱" : "暂无收藏菜谱"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {search ? "请尝试其他关键词" : "在“今天吃什么”推荐方案中点击“收藏”，即可在这里直接看页面做饭。"}
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {filtered.map((recipe) => (
            <article
              key={recipe.id}
              onClick={() => setSelectedRecipe(recipe)}
              className="group relative flex cursor-pointer overflow-hidden rounded-2xl border border-white/80 bg-white shadow-[0_3px_14px_rgba(23,63,53,.05)] transition hover:shadow-md active:scale-98"
            >
              {recipe.cover ? (
                <div className="h-28 w-28 shrink-0 bg-slate-100">
                  {/* eslint-disable-next-html-element-suppression */}
                  <img src={recipe.cover} alt={recipe.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center bg-[#173f35] font-bold text-white">
                  菜谱
                </div>
              )}

              <div className="flex flex-1 flex-col justify-between p-3.5">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-[#173f35] leading-snug">{recipe.name}</h3>
                    <button
                      type="button"
                      onClick={(e) => void removeFavorite(recipe.id, recipe.name, e)}
                      className="shrink-0 text-xs font-medium text-rose-500 hover:text-rose-700"
                      title="取消收藏"
                    >
                      删除
                    </button>
                  </div>
                  {recipe.score && <p className="mt-1 text-xs font-semibold text-amber-600">⭐ {recipe.score} 分</p>}
                </div>

                <div className="flex items-center justify-between text-xs text-[#6f8178]">
                  <span>{recipe.steps ? `${recipe.steps.length} 个步骤` : "无详细步骤"}</span>
                  <span className="font-semibold text-[#173f35] group-hover:underline">📖 开始做饭 →</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedRecipe && <CookingModal recipe={selectedRecipe} onClose={() => setSelectedRecipe(null)} />}
    </section>
  );
}
