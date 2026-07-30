"use client";

import { useEffect, useState } from "react";

import { foodCategories } from "@/lib/inventory/types";

type CategoryDefault = { category: (typeof foodCategories)[number]; shelfLifeDays: number };

export function ShelfLifeSettings() {
  const [defaults, setDefaults] = useState<CategoryDefault[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/settings/category-defaults").then(async (response) => {
      const data = await response.json() as { defaults?: CategoryDefault[] };
      if (response.ok && data.defaults) setDefaults(data.defaults);
    }).catch(() => setNotice("默认有效期暂时无法读取"));
  }, []);

  async function save(category: CategoryDefault["category"], shelfLifeDays: number) {
    if (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 0) return;
    setNotice("");
    const response = await fetch("/api/settings/category-defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, shelfLifeDays }) });
    if (!response.ok) { setNotice("无法保存默认有效期"); return; }
    setNotice("默认有效期已保存");
  }

  const entries = foodCategories.map((category) => ({ category, shelfLifeDays: defaults.find((item) => item.category === category)?.shelfLifeDays ?? 0 }));
  return <details className="rounded-3xl bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-semibold">各类别默认有效期</summary><p className="mt-2 text-sm leading-6 text-slate-600">新入库未指定过期日时，系统按这里的天数从购买日计算；单个批次仍可单独修改。</p><div className="mt-3 grid grid-cols-2 gap-2">{entries.map((item) => <label key={`${item.category}-${item.shelfLifeDays}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{item.category}</span><input type="number" min="0" step="1" aria-label={`${item.category} 默认有效期`} defaultValue={item.shelfLifeDays} onBlur={(event) => void save(item.category, Number(event.target.value))} className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right" /><span className="text-slate-500">天</span></label>)}</div>{notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}</details>;
}
