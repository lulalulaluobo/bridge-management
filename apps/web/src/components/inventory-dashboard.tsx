"use client";

import { useMemo, useState } from "react";

import {
  foodCategories,
  storageLocations,
  type FoodBatchWithStatus,
  type OperationProposal,
} from "@/lib/inventory/types";

type AddForm = {
  name: string;
  category: (typeof foodCategories)[number];
  quantity: string;
  unit: string;
  purchasedAt: string;
  storageLocation: (typeof storageLocations)[number];
  opened: boolean;
};

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const initialForm: AddForm = {
  name: "",
  category: "其他",
  quantity: "1",
  unit: "份",
  purchasedAt: today,
  storageLocation: "冷藏室",
  opened: false,
};

export function InventoryDashboard({ initialBatches }: { initialBatches: FoodBatchWithStatus[] }) {
  const [batches, setBatches] = useState<FoodBatchWithStatus[]>(initialBatches);
  const [form, setForm] = useState<AddForm>(initialForm);
  const [proposal, setProposal] = useState<OperationProposal | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => ({
    expired: batches.filter((batch) => batch.status === "expired"),
    expiring: batches.filter((batch) => batch.status === "expiring"),
    normal: batches.filter((batch) => batch.status === "normal"),
  }), [batches]);

  async function loadInventory() {
    const response = await fetch("/api/inventory", { cache: "no-store" });
    const data = (await response.json()) as { batches: FoodBatchWithStatus[] };
    setBatches(data.batches);
  }

  async function createPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "add_batches",
          batches: [{ ...form, quantity: Number(form.quantity) }],
        }),
      });
      const data = (await response.json()) as { proposal?: OperationProposal; error?: string };
      if (!response.ok || !data.proposal) throw new Error(data.error ?? "无法生成预览");
      setProposal(data.proposal);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法生成预览");
    } finally {
      setBusy(false);
    }
  }

  async function confirmProposal() {
    if (!proposal) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/proposals/${proposal.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "写入失败");
      setProposal(null);
      setForm(initialForm);
      setNotice("已确认入库，库存已更新。");
      await loadInventory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "写入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 bg-[#f7f7f2] px-4 py-6 text-slate-900">
      <header className="rounded-3xl bg-[#173f35] p-5 text-white shadow-sm">
        <p className="text-sm text-emerald-100">家庭冰箱 Agent</p>
        <h1 className="mt-1 text-2xl font-semibold">先把临期食材吃掉</h1>
        <p className="mt-2 text-sm leading-6 text-emerald-50">所有来源的写入都会先生成预览，再由你确认。</p>
      </header>

      <section className="grid grid-cols-3 gap-2" aria-label="库存状态">
        <StatusCard label="已过期" value={groups.expired.length} tone="rose" />
        <StatusCard label="快过期" value={groups.expiring.length} tone="amber" />
        <StatusCard label="正常库存" value={groups.normal.length} tone="emerald" />
      </section>

      <section className="rounded-3xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">手动入库</h2>
        <p className="mt-1 text-sm text-slate-600">这是语音、拍照或智能对话不可用时的替代路径。</p>
        <form className="mt-4 grid gap-3" onSubmit={createPreview}>
          <label className="grid gap-1 text-sm font-medium">食物名称
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2" placeholder="例如：菠菜" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-medium">数量
              <input required min="0.01" step="0.01" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm font-medium">单位
              <input required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="类别" value={form.category} options={foodCategories} onChange={(value) => setForm({ ...form, category: value as AddForm["category"] })} />
            <SelectField label="存放位置" value={form.storageLocation} options={storageLocations} onChange={(value) => setForm({ ...form, storageLocation: value as AddForm["storageLocation"] })} />
          </div>
          <label className="grid gap-1 text-sm font-medium">购买日期
            <input required type="date" value={form.purchasedAt} onChange={(event) => setForm({ ...form, purchasedAt: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.opened} onChange={(event) => setForm({ ...form, opened: event.target.checked })} /> 已开封</label>
          <button disabled={busy} className="rounded-xl bg-[#173f35] px-4 py-3 font-semibold text-white disabled:opacity-50">生成入库预览</button>
        </form>
      </section>

      {proposal?.action.type === "add_batches" && (
        <section className="rounded-3xl border-2 border-[#173f35] bg-white p-4 shadow-sm" aria-live="polite">
          <p className="text-sm font-semibold text-[#173f35]">待确认入库</p>
          {proposal.action.batches.map((batch) => (
            <div key={`${batch.name}-${batch.purchasedAt}`} className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">
              <p className="font-semibold">{batch.name} · {batch.quantity}{batch.unit}</p>
              <p className="mt-1 text-slate-600">{batch.category}｜{batch.storageLocation}｜预计 {batch.expiresAt} 过期</p>
            </div>
          ))}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setProposal(null)} disabled={busy} className="rounded-xl border border-slate-300 px-4 py-3 font-semibold">取消</button>
            <button type="button" onClick={confirmProposal} disabled={busy} className="rounded-xl bg-[#173f35] px-4 py-3 font-semibold text-white disabled:opacity-50">确认入库</button>
          </div>
        </section>
      )}

      {notice && <p className="rounded-xl bg-white px-4 py-3 text-sm shadow-sm" role="status">{notice}</p>}

      <section className="rounded-3xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">当前库存</h2>
        <div className="mt-3 grid gap-2">
          {batches.length === 0 ? <p className="text-sm text-slate-600">还没有库存。先添加今天买到的食物吧。</p> : batches.map((batch) => <BatchCard key={batch.id} batch={batch} />)}
        </div>
      </section>
    </main>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-sm font-medium">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function StatusCard({ label, value, tone }: { label: string; value: number; tone: "rose" | "amber" | "emerald" }) {
  const styles = { rose: "bg-rose-100 text-rose-900", amber: "bg-amber-100 text-amber-900", emerald: "bg-emerald-100 text-emerald-900" };
  return <div className={`rounded-2xl p-3 ${styles[tone]}`}><p className="text-xs font-medium">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}

function BatchCard({ batch }: { batch: FoodBatchWithStatus }) {
  const labels = { expired: "已过期", expiring: "快过期", normal: "正常" };
  const colors = { expired: "bg-rose-100 text-rose-800", expiring: "bg-amber-100 text-amber-800", normal: "bg-emerald-100 text-emerald-800" };
  return <article className="rounded-2xl bg-slate-50 p-3"><div className="flex justify-between gap-3"><p className="font-semibold">{batch.name}</p><span className={`h-fit rounded-full px-2 py-1 text-xs font-semibold ${colors[batch.status]}`}>{labels[batch.status]}</span></div><p className="mt-1 text-sm text-slate-600">{batch.quantity}{batch.unit} · {batch.storageLocation}{batch.opened ? " · 已开封" : ""}</p><p className="mt-1 text-sm text-slate-600">预计过期：{batch.expiresAt}</p></article>;
}
