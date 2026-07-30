"use client";

import { useEffect, useState } from "react";

import { foodCategories, storageLocations } from "@/lib/inventory/types";

type CategoryDefault = { category: (typeof foodCategories)[number]; shelfLifeDays: number; storageLocation: (typeof storageLocations)[number] };

const fallbackStorage: Record<(typeof foodCategories)[number], (typeof storageLocations)[number]> = { 蔬菜: "冷藏室", 水果: "冷藏室", 乳制品: "冷藏室", 肉类: "冷藏室", 海鲜: "冷冻室", 主食: "常温柜", 饮料: "常温柜", 其他: "冷藏室" };
const fallbackDays: Record<(typeof foodCategories)[number], number> = { 蔬菜: 4, 水果: 7, 乳制品: 7, 肉类: 3, 海鲜: 2, 主食: 30, 饮料: 14, 其他: 7 };

export function ShelfLifeSettings() {
  const [defaults, setDefaults] = useState<CategoryDefault[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/settings/category-defaults").then(async (response) => {
      const data = await response.json() as { defaults?: CategoryDefault[] };
      if (response.ok && data.defaults) setDefaults(data.defaults);
    }).catch(() => setNotice("默认规则暂时无法读取"));
  }, []);

  const entries = foodCategories.map((category) => defaults.find((item) => item.category === category) ?? { category, shelfLifeDays: fallbackDays[category], storageLocation: fallbackStorage[category] });
  async function save(entry: CategoryDefault) {
    if (!Number.isInteger(entry.shelfLifeDays) || entry.shelfLifeDays < 0) return;
    setNotice("");
    const response = await fetch("/api/settings/category-defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
    if (!response.ok) { setNotice("无法保存默认规则"); return; }
    setDefaults((current) => [...current.filter((item) => item.category !== entry.category), entry]);
    setNotice("默认规则已保存");
  }

  return <details className="rounded-3xl bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-semibold">新食物默认规则</summary><p className="mt-2 text-sm leading-6 text-slate-600">只说“买了什么”时，Agent 会按这两张表补全存放位置和预计过期日；单个批次仍可在库存页修改。</p><section className="mt-4"><h3 className="text-sm font-semibold text-slate-800">默认存放位置</h3><div className="mt-2 grid grid-cols-2 gap-2">{entries.map((item) => <label key={`storage-${item.category}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{item.category}</span><select aria-label={`${item.category} 默认存放位置`} value={item.storageLocation} onChange={(event) => void save({ ...item, storageLocation: event.target.value as CategoryDefault["storageLocation"] })} className="max-w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right">{storageLocations.map((location) => <option key={location}>{location}</option>)}</select></label>)}</div></section><section className="mt-5"><h3 className="text-sm font-semibold text-slate-800">默认有效期</h3><div className="mt-2 grid grid-cols-2 gap-2">{entries.map((item) => <label key={`shelf-${item.category}-${item.shelfLifeDays}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{item.category}</span><span className="flex items-center gap-1"><input type="number" min="0" step="1" aria-label={`${item.category} 默认有效期`} defaultValue={item.shelfLifeDays} onBlur={(event) => void save({ ...item, shelfLifeDays: Number(event.target.value) })} className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right" /><span className="text-slate-500">天</span></span></label>)}</div></section>{notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}</details>;
}
