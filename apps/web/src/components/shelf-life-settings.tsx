"use client";

import { useEffect, useState } from "react";

import { foodCategories, storageLocations } from "@/lib/inventory/types";

type CategoryDefault = { category: (typeof foodCategories)[number]; shelfLifeDays: number; storageLocation: (typeof storageLocations)[number] };
type FoodDefaultRule = { name: string; shelfLifeDays: number; storageLocation: (typeof storageLocations)[number] };

const fallbackStorage: Record<(typeof foodCategories)[number], (typeof storageLocations)[number]> = { 蔬菜: "冷藏室", 水果: "冷藏室", 乳制品: "冷藏室", 肉类: "冷藏室", 海鲜: "冷冻室", 主食: "常温柜", 饮料: "常温柜", 其他: "冷藏室" };
const fallbackDays: Record<(typeof foodCategories)[number], number> = { 蔬菜: 4, 水果: 7, 乳制品: 7, 肉类: 3, 海鲜: 2, 主食: 30, 饮料: 14, 其他: 7 };

export function ShelfLifeSettings() {
  const [defaults, setDefaults] = useState<CategoryDefault[]>([]);
  const [rules, setRules] = useState<FoodDefaultRule[]>([]);
  const [draft, setDraft] = useState<FoodDefaultRule>({ name: "", shelfLifeDays: 7, storageLocation: "冷藏室" });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void fetch("/api/settings/category-defaults").then(async (response) => {
      const data = await response.json() as { defaults?: CategoryDefault[] };
      if (response.ok && data.defaults) setDefaults(data.defaults);
    }).catch(() => setNotice("默认规则暂时无法读取"));
    void fetch("/api/settings/food-default-rules").then(async (response) => {
      const data = await response.json() as { rules?: FoodDefaultRule[] };
      if (response.ok && data.rules) setRules(data.rules);
    }).catch(() => setNotice("食物默认规则暂时无法读取"));
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

  async function addRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || !Number.isInteger(draft.shelfLifeDays) || draft.shelfLifeDays < 0) return;
    const response = await fetch("/api/settings/food-default-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (!response.ok) { setNotice("无法保存食物默认规则"); return; }
    const rule = { ...draft, name: draft.name.trim() };
    setRules((current) => [...current.filter((item) => item.name !== rule.name), rule].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
    setDraft({ name: "", shelfLifeDays: 7, storageLocation: "冷藏室" }); setNotice("食物默认规则已保存");
  }

  async function deleteRule(name: string) {
    const response = await fetch("/api/settings/food-default-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!response.ok) { setNotice("无法删除食物默认规则"); return; }
    setRules((current) => current.filter((item) => item.name !== name)); setNotice("食物默认规则已删除");
  }

  return <details className="rounded-3xl bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-semibold">新食物默认规则</summary><p className="mt-2 text-sm leading-6 text-slate-600">只说“买了什么”时，优先匹配具体食物；没有匹配时再按类别补全存放位置和预计过期日。</p><section className="mt-4"><h3 className="text-sm font-semibold text-slate-800">常用食物规则</h3><form onSubmit={addRule} className="mt-2 grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-slate-50 p-2"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：大米" aria-label="食物名称" className="min-w-0 rounded-xl bg-white px-3 py-2 text-sm" /><button className="rounded-xl bg-[#173f35] px-3 text-sm font-semibold text-white" aria-label="添加食物默认规则">添加</button><select value={draft.storageLocation} onChange={(event) => setDraft({ ...draft, storageLocation: event.target.value as FoodDefaultRule["storageLocation"] })} aria-label="默认存放位置" className="rounded-xl bg-white px-3 py-2 text-sm">{storageLocations.map((location) => <option key={location}>{location}</option>)}</select><label className="flex items-center justify-end gap-1 rounded-xl bg-white px-3 py-2 text-sm"><input type="number" min="0" value={draft.shelfLifeDays} onChange={(event) => setDraft({ ...draft, shelfLifeDays: Number(event.target.value) })} aria-label="默认有效期" className="w-12 text-right outline-none" />天</label></form>{rules.length > 0 && <div className="mt-2 grid gap-2">{rules.map((rule) => <div key={rule.name} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="font-semibold">{rule.name}</span><span className="ml-auto text-slate-600">{rule.storageLocation} · {rule.shelfLifeDays}天</span><button type="button" onClick={() => void deleteRule(rule.name)} className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-700" aria-label={`删除 ${rule.name} 默认规则`}>删除</button></div>)}</div>}</section><section className="mt-5"><h3 className="text-sm font-semibold text-slate-800">类别默认存放位置</h3><div className="mt-2 grid grid-cols-2 gap-2">{entries.map((item) => <label key={`storage-${item.category}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{item.category}</span><select aria-label={`${item.category} 默认存放位置`} value={item.storageLocation} onChange={(event) => void save({ ...item, storageLocation: event.target.value as CategoryDefault["storageLocation"] })} className="max-w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right">{storageLocations.map((location) => <option key={location}>{location}</option>)}</select></label>)}</div></section><section className="mt-5"><h3 className="text-sm font-semibold text-slate-800">类别默认有效期</h3><div className="mt-2 grid grid-cols-2 gap-2">{entries.map((item) => <label key={`shelf-${item.category}-${item.shelfLifeDays}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span>{item.category}</span><span className="flex items-center gap-1"><input type="number" min="0" step="1" aria-label={`${item.category} 默认有效期`} defaultValue={item.shelfLifeDays} onBlur={(event) => void save({ ...item, shelfLifeDays: Number(event.target.value) })} className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right" /><span className="text-slate-500">天</span></span></label>)}</div></section>{notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}</details>;
}
