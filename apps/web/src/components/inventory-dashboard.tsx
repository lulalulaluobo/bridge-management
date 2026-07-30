"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LlmSettings } from "@/components/llm-settings";
import { AgentWriteSettings } from "@/components/agent-write-settings";
import { MealRecommendations } from "@/components/meal-recommendations";
import { NotificationControl } from "@/components/notification-control";
import { ShelfLifeSettings } from "@/components/shelf-life-settings";
import { foodCategories, storageLocations, type FoodBatchWithStatus, type OperationProposal, type ProposalAction } from "@/lib/inventory/types";
import type { CredentialSummary } from "@/lib/llm/credentials";
import type { FoodCandidate } from "@/lib/media/recognition";
import type { FoodPreferences } from "@/lib/preferences";

type AddForm = { name: string; category: (typeof foodCategories)[number]; quantity: string; unit: string; purchasedAt: string; storageLocation: (typeof storageLocations)[number]; opened: boolean };
type Tab = "today" | "inventory" | "more";
type BatchChanges = Extract<ProposalAction, { type: "update_batch" }>["changes"];
type AgentPhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

const todayValue = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const initialForm: AddForm = { name: "", category: "其他", quantity: "1", unit: "份", purchasedAt: todayValue, storageLocation: "冷藏室", opened: false };
const updateLabels: Record<string, string> = { name: "名称", category: "类别", quantity: "数量", unit: "单位", purchasedAt: "购买日期", expiresAt: "预计过期日", storageLocation: "存放位置", opened: "开封状态" };

export function InventoryDashboard({ initialBatches, initialCredentials, initialPreferences, vapidPublicKey }: { initialBatches: FoodBatchWithStatus[]; initialCredentials: CredentialSummary[]; initialPreferences: FoodPreferences; vapidPublicKey: string }) {
  const [batches, setBatches] = useState(initialBatches);
  const [form, setForm] = useState<AddForm>(initialForm);
  const [proposal, setProposal] = useState<OperationProposal | null>(null);
  const [proposalKey, setProposalKey] = useState<string | null>(null);
  const [photoCandidates, setPhotoCandidates] = useState<FoodCandidate[] | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
  const [messages, setMessages] = useState<Array<{ role: "assistant" | "user"; content: string }>>([{ role: "assistant", content: "你好，我会记住冰箱里的东西，也会提醒你先吃什么。" }]);
  const groups = useMemo(() => ({ expired: batches.filter((item) => item.status === "expired"), expiring: batches.filter((item) => item.status === "expiring"), normal: batches.filter((item) => item.status === "normal") }), [batches]);

  async function loadInventory() { const response = await fetch("/api/inventory", { cache: "no-store" }); const data = await response.json() as { batches: FoodBatchWithStatus[] }; setBatches(data.batches); }
  async function queueAction(action: ProposalAction) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const data = await response.json() as { proposal?: OperationProposal; error?: string };
      if (!response.ok || !data.proposal) throw new Error(data.error ?? "无法生成预览");
      setProposal(data.proposal); setProposalKey(crypto.randomUUID()); setShowAdd(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法生成预览"); } finally { setBusy(false); }
  }
  async function createPreview(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); await queueAction({ type: "add_batches", batches: [{ ...form, quantity: Number(form.quantity) }] }); }
  async function confirmProposal() {
    if (!proposal || !proposalKey) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/proposals/${proposal.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: proposalKey }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "写入失败");
      setProposal(null); setProposalKey(null); setForm(initialForm); setNotice("已更新冰箱库存"); await loadInventory();
    } catch (error) { setNotice(error instanceof Error ? error.message : "写入失败"); } finally { setBusy(false); }
  }
  async function askAgent(message: string) {
    stopBrowserSpeech(); setBusy(true); setNotice(""); setAgentPhase("thinking"); setMessages((items) => [...items, { role: "user", content: message }]);
    try {
      const context = [...messages.slice(-7), { role: "user" as const, content: message }];
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, context, idempotencyKey: crypto.randomUUID() }) });
      const data = await response.json() as { message?: string; proposal?: OperationProposal | null; committed?: unknown; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error ?? "Agent 暂时无法回复");
      setMessages((items) => [...items, { role: "assistant", content: data.message! }]);
      if (voiceReplies) {
        setAgentPhase("speaking");
        speakReply(data.message!, () => setAgentPhase((phase) => phase === "speaking" ? "idle" : phase));
      } else setAgentPhase("idle");
      if (data.proposal) { setProposal(data.proposal); setProposalKey(crypto.randomUUID()); }
      if (data.committed) await loadInventory();
    } catch (error) { setAgentPhase("idle"); setMessages((items) => [...items, { role: "assistant", content: error instanceof Error ? error.message : "Agent 暂时无法回复" }]); } finally { setBusy(false); }
  }
  async function sendMessage(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const message = chatInput.trim(); if (!message) return; setChatInput(""); await askAgent(message); }
  async function recognizeImage(file: File) {
    setBusy(true); setNotice("");
    try {
      const upload = new FormData(); upload.set("image", file);
      const response = await fetch("/api/media/image", { method: "POST", body: upload }); const data = await response.json() as { candidates?: FoodCandidate[]; error?: string };
      if (!response.ok || !data.candidates?.length) throw new Error(data.error ?? "没有识别到可入库的食物，请手动添加");
      setPhotoCandidates(data.candidates);
    } catch (error) { setNotice(error instanceof Error ? error.message : "图片识别失败，请改用手动入库"); } finally { setBusy(false); }
  }
  async function transcribeAndSend(audio: Blob) {
    setBusy(true); setNotice(""); setAgentPhase("transcribing");
    try {
      const upload = new FormData(); upload.set("audio", audio, "voice-message.webm");
      const response = await fetch("/api/media/transcribe", { method: "POST", body: upload }); const data = await response.json() as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error ?? "语音识别失败");
      await askAgent(data.text);
    } catch (error) { setAgentPhase("idle"); setNotice(error instanceof Error ? error.message : "语音识别失败，请改用文字输入"); } finally { setBusy(false); }
  }
  function toggleVoiceReplies() {
    setVoiceReplies((enabled) => {
      if (enabled) { stopBrowserSpeech(); setAgentPhase("idle"); }
      return !enabled;
    });
  }
  function consume(batch: FoodBatchWithStatus) { const value = window.prompt(`消耗多少 ${batch.unit}？当前有 ${batch.quantity}${batch.unit}`, "1"); const quantity = Number(value); if (!value) return; if (!Number.isFinite(quantity) || quantity <= 0) { setNotice("请输入大于 0 的消耗数量"); return; } void queueAction({ type: "consume_batch", batchId: batch.id, quantity }); }

  return <main className="min-h-[100dvh] bg-[#f3f4f0] pb-36 text-[#17231f]">
    <div className="mx-auto w-full max-w-xl px-5 pt-[max(1.2rem,env(safe-area-inset-top))]">
      {tab === "today" && <TodayView messages={messages} chatInput={chatInput} busy={busy} agentPhase={agentPhase} setAgentPhase={setAgentPhase} setChatInput={setChatInput} sendMessage={sendMessage} recognizeImage={recognizeImage} transcribe={transcribeAndSend} voiceError={setNotice} voiceReplies={voiceReplies} toggleVoiceReplies={toggleVoiceReplies} openAdd={() => setShowAdd(true)} />}
      {tab === "inventory" && <InventoryView batches={batches} groups={groups} onAdd={() => setShowAdd(true)} onConsume={consume} onOpen={(batch) => void queueAction({ type: "update_batch", batchId: batch.id, changes: { opened: !batch.opened } })} onEdit={(batch, changes) => void queueAction({ type: "update_batch", batchId: batch.id, changes })} onDelete={(batch) => void queueAction({ type: "soft_delete_batch", batchId: batch.id })} />}
      {tab === "more" && <MoreView initialCredentials={initialCredentials} initialPreferences={initialPreferences} vapidPublicKey={vapidPublicKey} />}
    </div>
    {notice && <p role="status" className="fixed inset-x-5 bottom-28 z-40 mx-auto max-w-md rounded-2xl bg-[#17231f] px-4 py-3 text-sm font-medium text-white shadow-xl">{notice}</p>}
    {showAdd && <AddSheet form={form} setForm={setForm} busy={busy} onClose={() => setShowAdd(false)} onSubmit={createPreview} />}
    {photoCandidates && <PhotoCandidatesSheet candidates={photoCandidates} onClose={() => setPhotoCandidates(null)} onContinue={(candidates) => { setPhotoCandidates(null); void queueAction({ type: "add_batches", batches: candidates.map((item) => ({ ...item, purchasedAt: todayValue })) }); }} />}
    {proposal && <ProposalSheet proposal={proposal} busy={busy} onCancel={() => { setProposal(null); setProposalKey(null); }} onConfirm={confirmProposal} />}
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-[#f7f8f5]/90 px-5 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl"><div className="mx-auto grid max-w-xl grid-cols-3"><TabButton active={tab === "today"} label="今天" icon="home" onClick={() => setTab("today")} /><TabButton active={tab === "inventory"} label="库存" icon="grid" onClick={() => setTab("inventory")} /><TabButton active={tab === "more"} label="更多" icon="sliders" onClick={() => setTab("more")} /></div></nav>
  </main>;
}

function TodayView({ messages, chatInput, busy, agentPhase, setAgentPhase, setChatInput, sendMessage, recognizeImage, transcribe, voiceError, voiceReplies, toggleVoiceReplies, openAdd }: { messages: Array<{ role: "assistant" | "user"; content: string }>; chatInput: string; busy: boolean; agentPhase: AgentPhase; setAgentPhase: (phase: AgentPhase) => void; setChatInput: (value: string) => void; sendMessage: (event: React.FormEvent<HTMLFormElement>) => void; recognizeImage: (file: File) => void; transcribe: (audio: Blob) => void; voiceError: (message: string) => void; voiceReplies: boolean; toggleVoiceReplies: () => void; openAdd: () => void }) {
  const latestReply = [...messages].reverse().find((message) => message.role === "assistant")?.content;
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content;
  const statusText: Record<AgentPhase, string> = { idle: latestReply ?? "长按我说话，我会帮你记住冰箱里的东西。", listening: "我在听，你可以继续说。", transcribing: "正在听懂你刚才的话…", thinking: "让我看看该怎么处理。", speaking: latestReply ?? "我来告诉你。" };
  const statusLabel: Record<AgentPhase, string> = { idle: "长按说话", listening: "正在听，松开后发送", transcribing: "正在识别", thinking: "正在整理", speaking: "正在回复" };
  return <><section className="mt-2 flex items-center justify-between"><h1 className="text-[25px] font-bold tracking-[-.045em]">冰箱小精灵</h1><button type="button" onClick={toggleVoiceReplies} className="grid h-11 w-11 place-items-center rounded-full bg-white text-[#173f35] shadow-[0_5px_16px_rgba(23,63,53,.08)] active:scale-95" aria-label={voiceReplies ? "停止并关闭语音回复" : "开启语音回复"} title={voiceReplies ? "停止并关闭语音回复" : "开启语音回复"}><Icon name={voiceReplies ? "speaker" : "mute"} /></button></section>
    <section className="relative mx-auto mt-3 flex min-h-[calc(100dvh-17rem)] max-w-sm flex-col items-center justify-center pb-20"><div aria-live="polite" className="relative z-10 max-w-[19rem] rounded-[24px] bg-white px-4 py-3 text-[15px] leading-6 text-[#25332d] shadow-[0_8px_28px_rgba(23,63,53,.10)] after:absolute after:bottom-[-8px] after:left-1/2 after:h-4 after:w-4 after:-translate-x-1/2 after:rotate-45 after:bg-white">{statusText[agentPhase]}</div>{latestUserMessage && agentPhase !== "idle" && <p className="mt-4 max-w-[17rem] truncate rounded-full bg-[#e1ebe5] px-3 py-1.5 text-sm text-[#405148]">你：{latestUserMessage}</p>}<VoiceButton hero disabled={busy && agentPhase !== "speaking"} phase={agentPhase} onAudio={transcribe} onError={voiceError} onPhaseChange={setAgentPhase} /><p className="mt-1 text-sm font-medium text-[#64736c]">{statusLabel[agentPhase]}</p></section>
    <form onSubmit={sendMessage} className="fixed inset-x-5 bottom-[calc(4.8rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[calc(36rem-2.5rem)] items-center gap-2 rounded-[22px] border border-white/80 bg-white/95 p-2 shadow-[0_10px_30px_rgba(23,63,53,.14)] backdrop-blur-xl"><button type="button" onClick={openAdd} disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-[16px] bg-[#dcece3] text-[#173f35] active:scale-95 disabled:opacity-50" aria-label="手动添加食材"><Icon name="plus" /></button><label className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-[16px] bg-[#edf0eb] text-[#173f35] active:scale-95 ${busy ? "pointer-events-none opacity-50" : ""}`} aria-label="拍照识别"><Icon name="camera" /><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void recognizeImage(file); event.currentTarget.value = ""; }} /></label><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] outline-none" placeholder="输入文字…" /><button disabled={busy || !chatInput.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-[16px] bg-[#173f35] text-white disabled:opacity-40" aria-label="发送"><Icon name="arrow" /></button></form><div className="h-24" /></>;
}

function InventoryView({ batches, groups, onAdd, onConsume, onOpen, onEdit, onDelete }: { batches: FoodBatchWithStatus[]; groups: { expired: FoodBatchWithStatus[]; expiring: FoodBatchWithStatus[]; normal: FoodBatchWithStatus[] }; onAdd: () => void; onConsume: (batch: FoodBatchWithStatus) => void; onOpen: (batch: FoodBatchWithStatus) => void; onEdit: (batch: FoodBatchWithStatus, changes: BatchChanges) => void; onDelete: (batch: FoodBatchWithStatus) => void }) {
  return <section className="mt-7"><div className="flex items-center justify-between"><div><h2 className="text-[25px] font-bold tracking-[-.04em]">库存</h2><p className="mt-1 text-sm text-[#6f8178]">{batches.length} 个采购批次</p></div><button type="button" onClick={onAdd} className="grid h-11 w-11 place-items-center rounded-full bg-[#173f35] text-white shadow-lg active:scale-95" aria-label="手动入库"><Icon name="plus" /></button></div>{batches.length === 0 ? <EmptyInventory onAdd={onAdd} /> : <div className="mt-6 grid gap-6">{(["expired", "expiring", "normal"] as const).map((status) => groups[status].length > 0 && <section key={status}><p className="mb-2 text-sm font-semibold text-[#6f8178]">{{ expired: "已过期", expiring: "即将过期", normal: "正常库存" }[status]}</p><div className="overflow-hidden rounded-[24px] bg-white shadow-[0_3px_14px_rgba(23,63,53,.05)]">{groups[status].map((batch, index) => <BatchRow key={batch.id} batch={batch} first={index === 0} onConsume={() => onConsume(batch)} onOpen={() => onOpen(batch)} onEdit={(changes) => onEdit(batch, changes)} onDelete={() => onDelete(batch)} />)}</div></section>)}</div>}</section>;
}

function MoreView({ initialCredentials, initialPreferences, vapidPublicKey }: { initialCredentials: CredentialSummary[]; initialPreferences: FoodPreferences; vapidPublicKey: string }) { return <section className="mt-7 grid gap-5"><div><h2 className="text-[25px] font-bold tracking-[-.04em]">更多</h2><p className="mt-1 text-sm text-[#6f8178]">偏好、提醒与模型设置</p></div><AgentWriteSettings /><MealRecommendations initialPreferences={initialPreferences} /><NotificationControl vapidPublicKey={vapidPublicKey} /><ShelfLifeSettings /><LlmSettings initialCredentials={initialCredentials} /></section>; }

function AddSheet({ form, setForm, busy, onClose, onSubmit }: { form: AddForm; setForm: (value: AddForm) => void; busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <Sheet title="添加食材" onClose={onClose}><form className="grid gap-4" onSubmit={onSubmit}><Field label="食物名称"><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：菠菜" /></Field><div className="grid grid-cols-2 gap-3"><Field label="数量"><input required min="0.01" step="0.01" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="单位"><input required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="类别"><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as AddForm["category"] })}>{foodCategories.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="存放位置"><select value={form.storageLocation} onChange={(event) => setForm({ ...form, storageLocation: event.target.value as AddForm["storageLocation"] })}>{storageLocations.map((item) => <option key={item}>{item}</option>)}</select></Field></div><Field label="购买日期"><input required type="date" value={form.purchasedAt} onChange={(event) => setForm({ ...form, purchasedAt: event.target.value })} /></Field><label className="flex items-center gap-3 rounded-2xl bg-[#f3f4f0] px-4 py-3 text-sm font-medium"><input type="checkbox" checked={form.opened} onChange={(event) => setForm({ ...form, opened: event.target.checked })} /> 已开封</label><button disabled={busy} className="mt-1 rounded-2xl bg-[#173f35] py-4 font-semibold text-white shadow-lg disabled:opacity-50">生成入库预览</button></form></Sheet>; }

function PhotoCandidatesSheet({ candidates, onClose, onContinue }: { candidates: FoodCandidate[]; onClose: () => void; onContinue: (candidates: FoodCandidate[]) => void }) {
  const [items, setItems] = useState(candidates);
  function update(index: number, changes: Partial<FoodCandidate>) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item)); }
  return <Sheet title="核对照片里的食材" onClose={onClose}><p className="-mt-2 mb-4 text-sm leading-5 text-[#64736c]">识别结果仅是候选。可直接修改、删除后，再生成入库预览。</p><div className="grid max-h-[55dvh] gap-3 overflow-y-auto pr-1">{items.map((item, index) => <article key={`${item.name}-${index}`} className="rounded-2xl bg-[#f0f2ed] p-3"><div className="flex gap-2"><input aria-label={`食材名称 ${index + 1}`} value={item.name} onChange={(event) => update(index, { name: event.target.value })} className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold" /><button type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl bg-white px-3 text-xs font-semibold text-rose-700" aria-label={`删除 ${item.name}`}>删除</button></div><div className="mt-2 grid grid-cols-2 gap-2"><input aria-label={`数量 ${item.name}`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => update(index, { quantity: Number(event.target.value) })} className="rounded-xl bg-white px-3 py-2 text-sm" /><input aria-label={`单位 ${item.name}`} value={item.unit} onChange={(event) => update(index, { unit: event.target.value })} className="rounded-xl bg-white px-3 py-2 text-sm" /><select aria-label={`类别 ${item.name}`} value={item.category} onChange={(event) => update(index, { category: event.target.value as FoodCandidate["category"] })} className="rounded-xl bg-white px-3 py-2 text-sm">{foodCategories.map((category) => <option key={category}>{category}</option>)}</select><select aria-label={`位置 ${item.name}`} value={item.storageLocation} onChange={(event) => update(index, { storageLocation: event.target.value as FoodCandidate["storageLocation"] })} className="rounded-xl bg-white px-3 py-2 text-sm">{storageLocations.map((location) => <option key={location}>{location}</option>)}</select></div></article>)}</div><button type="button" disabled={!items.length} onClick={() => onContinue(items)} className="mt-5 w-full rounded-2xl bg-[#173f35] py-4 font-semibold text-white disabled:opacity-50">生成入库预览</button></Sheet>;
}

function ProposalSheet({ proposal, busy, onCancel, onConfirm }: { proposal: OperationProposal; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const action = proposal.action;
  const summary = action.type === "consume_batch" ? `消耗 ${action.quantity} 件库存` : action.type === "soft_delete_batch" ? "从默认库存中删除此批次（保留记录）" : action.type === "update_batch" ? Object.entries(action.changes).map(([key, value]) => `${updateLabels[key] ?? key}：${value === true ? "已开封" : value === false ? "未开封" : value}`).join("\n") : "";
  return <Sheet title="确认这次操作" onClose={onCancel}>
    {action.type === "add_batches" ? <div className="grid max-h-[52dvh] gap-2 overflow-y-auto"><p className="text-sm text-[#64736c]">以下内容会写入冰箱；确认前可取消并重新调整。</p>{action.batches.map((item, index) => <article key={`${item.name}-${index}`} className="rounded-2xl bg-[#f3f4f0] px-4 py-3"><p className="font-semibold">{item.name} · {item.quantity}{item.unit}</p><p className="mt-1 text-sm text-[#53635b]">{item.category} · {item.storageLocation} · {item.opened ? "已开封" : "未开封"}</p><p className="mt-1 text-sm text-[#53635b]">购买：{item.purchasedAt}　预计过期：{item.expiresAt}</p></article>)}</div> : <p className="rounded-2xl bg-[#f3f4f0] px-4 py-4 whitespace-pre-line text-[15px] leading-6">{summary}</p>}
    <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} disabled={busy} className="rounded-2xl bg-[#eef0eb] py-4 font-semibold">取消</button><button type="button" onClick={onConfirm} disabled={busy} className="rounded-2xl bg-[#173f35] py-4 font-semibold text-white disabled:opacity-50">确认写入</button></div>
  </Sheet>;
}

function BatchRow({ batch, first, onConsume, onOpen, onEdit, onDelete }: { batch: FoodBatchWithStatus; first: boolean; onConsume: () => void; onOpen: () => void; onEdit: (changes: BatchChanges) => void; onDelete: () => void }) { const [editing, setEditing] = useState(false); const [quantity, setQuantity] = useState(String(batch.quantity)); const [expiresAt, setExpiresAt] = useState(batch.expiresAt); return <article className={`${first ? "" : "border-t border-[#edf0eb]"} px-4 py-4`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold tracking-[-.015em]">{batch.name}</p><p className="mt-1 text-sm text-[#66756d]">{batch.quantity}{batch.unit} · {batch.storageLocation}{batch.opened ? " · 已开封" : ""}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${batch.status === "expired" ? "bg-rose-100 text-rose-800" : batch.status === "expiring" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{batch.status === "expired" ? "已过期" : batch.status === "expiring" ? "快过期" : "正常"}</span></div><p className="mt-2 text-xs text-[#77857e]">预计 {batch.expiresAt} 过期</p><div className="mt-3 flex gap-2 overflow-x-auto pb-1"><SmallButton label="消耗" onClick={onConsume} /><SmallButton label={batch.opened ? "未开封" : "开封"} onClick={onOpen} /><SmallButton label="编辑" onClick={() => setEditing((value) => !value)} /><SmallButton label="删除" danger onClick={onDelete} /></div>{editing && <form className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-[#f3f4f0] p-3" onSubmit={(event) => { event.preventDefault(); const value = Number(quantity); if (Number.isFinite(value) && value > 0) { onEdit({ quantity: value, expiresAt }); setEditing(false); } }}><input className="rounded-xl bg-white px-3 py-2 text-sm" type="number" min="0.01" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label="数量" /><input className="rounded-xl bg-white px-3 py-2 text-sm" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} aria-label="预计过期日" /><button className="col-span-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#173f35]">生成修改预览</button></form>}</article>; }

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 flex items-end bg-[#17231f]/35 p-0 backdrop-blur-[2px]" role="dialog" aria-modal="true"><section className="w-full rounded-t-[30px] bg-[#fbfcf9] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl"><div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#cbd3cd]" /><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold tracking-[-.03em]">{title}</h2><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-[#eef0eb]" aria-label="关闭"><Icon name="close" /></button></div>{children}</section></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-semibold text-[#53635b]">{label}<span className="[&_input]:w-full [&_input]:rounded-xl [&_input]:border-0 [&_input]:bg-[#f0f2ed] [&_input]:px-3 [&_input]:py-3 [&_select]:w-full [&_select]:rounded-xl [&_select]:border-0 [&_select]:bg-[#f0f2ed] [&_select]:px-3 [&_select]:py-3">{children}</span></label>; }
function TabButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: IconName; onClick: () => void }) { return <button type="button" onClick={onClick} aria-label={label} title={label} className={`grid justify-items-center py-1 ${active ? "text-[#173f35]" : "text-[#819088]"}`}><span className={`grid h-9 w-12 place-items-center rounded-full ${active ? "bg-[#dcece3]" : ""}`}><Icon name={icon} /></span></button>; }
function SmallButton({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) { return <button type="button" onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${danger ? "bg-rose-50 text-rose-800" : "bg-[#eff2ee] text-[#405148]"}`}>{label}</button>; }
function EmptyInventory({ onAdd }: { onAdd: () => void }) { return <div className="mt-10 rounded-[28px] bg-white px-6 py-10 text-center shadow-[0_3px_14px_rgba(23,63,53,.05)]"><span className="inline-grid h-12 w-12 place-items-center rounded-2xl bg-[#dcece3] text-[#173f35]"><Icon name="box" /></span><p className="mt-4 font-semibold">冰箱还是空的</p><p className="mt-2 text-sm text-[#6f8178]">拍照、对话或手动添加今天买到的食物。</p><button type="button" onClick={onAdd} className="mt-5 rounded-full bg-[#173f35] px-5 py-3 text-sm font-semibold text-white">添加第一样食材</button></div>; }

function VoiceButton({ disabled, onAudio, onError, onPhaseChange, phase, hero = false }: { disabled: boolean; onAudio: (audio: Blob) => void; onError: (message: string) => void; onPhaseChange: (phase: AgentPhase) => void; phase: AgentPhase; hero?: boolean }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const pressed = useRef(false);
  const interruptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [armingInterrupt, setArmingInterrupt] = useState(false);

  useEffect(() => () => { if (interruptTimer.current) clearTimeout(interruptTimer.current); }, []);

  function clearInterruptArm() { if (interruptTimer.current) clearTimeout(interruptTimer.current); interruptTimer.current = null; pressStart.current = null; setArmingInterrupt(false); }
  async function start(target: HTMLButtonElement, pointerId: number) {
    if (disabled || recording || pressing) return;
    try {
      stopBrowserSpeech(); pressed.current = true; setPressing(true); onPhaseChange("listening");
      target.setPointerCapture(pointerId);
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!pressed.current) { stream.current.getTracks().forEach((track) => track.stop()); stream.current = null; setPressing(false); onPhaseChange("idle"); return; }
      const next = new MediaRecorder(stream.current);
      chunks.current = [];
      next.ondataavailable = (part) => { if (part.data.size) chunks.current.push(part.data); };
      next.onstop = () => { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; setPressing(false); setRecording(false); if (chunks.current.length) { onPhaseChange("transcribing"); onAudio(new Blob(chunks.current, { type: next.mimeType || "audio/webm" })); } else onPhaseChange("idle"); };
      recorder.current = next; next.start(); setRecording(true);
    } catch (error) { pressed.current = false; stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; setPressing(false); setRecording(false); onPhaseChange("idle"); onError(error instanceof DOMException && error.name === "NotAllowedError" ? "请允许麦克风权限后重试，或直接输入文字" : "无法打开麦克风，请直接输入文字"); }
  }
  function armOrStart(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || recording || pressing || armingInterrupt) return;
    if (phase !== "speaking") { void start(event.currentTarget, event.pointerId); return; }
    pressStart.current = { x: event.clientX, y: event.clientY }; setArmingInterrupt(true); event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.currentTarget; const pointerId = event.pointerId;
    interruptTimer.current = setTimeout(() => { clearInterruptArm(); void start(target, pointerId); }, 450);
  }
  function cancelArmOnMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!armingInterrupt || !pressStart.current) return;
    if (Math.hypot(event.clientX - pressStart.current.x, event.clientY - pressStart.current.y) > 12) clearInterruptArm();
  }
  function stop() { if (armingInterrupt) { clearInterruptArm(); return; } pressed.current = false; if (recorder.current?.state === "recording") recorder.current.stop(); else { setPressing(false); onPhaseChange("idle"); } }
  const listening = pressing || recording;
  if (hero) return <button type="button" disabled={disabled} onPointerDown={armOrStart} onPointerMove={cancelArmOnMove} onPointerUp={stop} onPointerCancel={stop} className={`group mt-7 flex w-full flex-col items-center rounded-[34px] px-5 py-4 outline-none transition-transform active:scale-[.98] disabled:opacity-70 ${listening ? "fridge-agent-listening" : phase === "thinking" ? "fridge-agent-thinking" : phase === "speaking" ? "fridge-agent-speaking" : ""}`} aria-label={listening ? "正在聆听，松开后发送" : phase === "speaking" ? "按住半秒打断回复并开始说话" : disabled ? "正在整理语音" : "长按冰箱小精灵说话"}><FridgeSprite phase={phase} listening={listening} /><span className={`mt-3 rounded-full px-4 py-2 text-sm font-semibold ${listening ? "bg-rose-100 text-rose-700" : phase === "thinking" ? "bg-amber-100 text-amber-800" : phase === "speaking" ? "bg-[#dcece3] text-[#173f35]" : disabled ? "bg-[#e5e9e4] text-[#64736c]" : "bg-[#dcece3] text-[#173f35]"}`}>{listening ? "正在听，松开后发送" : armingInterrupt ? "继续按住即可打断" : phase === "transcribing" ? "正在识别…" : phase === "thinking" ? "正在整理…" : phase === "speaking" ? "按住 0.5 秒可打断" : disabled ? "正在整理…" : "长按说话"}</span></button>;
  return <button type="button" disabled={disabled} onPointerDown={armOrStart} onPointerUp={stop} onPointerCancel={stop} className={`grid h-10 w-10 shrink-0 place-items-center rounded-[16px] transition-transform active:scale-95 ${listening ? "bg-rose-500 text-white" : "bg-[#dcece3] text-[#173f35]"}`} aria-label={listening ? "正在聆听，松开后发送" : "按住说话"} title={listening ? "松开后发送" : "按住说话"}><Icon name="mic" /></button>;
}

function FridgeSprite({ listening, phase }: { listening: boolean; phase: AgentPhase }) { return <div className="relative grid h-48 w-40 place-items-center"><span className={`fridge-agent-signal absolute h-40 w-40 rounded-full border-2 border-rose-300 ${listening ? "" : "hidden"}`} /><span className={`fridge-agent-signal absolute h-32 w-32 rounded-full border-2 border-rose-200 ${listening ? "[animation-delay:180ms]" : "hidden"}`} /><div className="fridge-agent-body relative h-40 w-28 rounded-[24px] border-[5px] border-[#173f35] bg-[#d8eee1] shadow-[0_14px_25px_rgba(23,63,53,.18)]"><div className="absolute inset-x-2 top-2 h-10 rounded-[13px] bg-[#f5faf6]" /><div className="absolute inset-x-2 top-[53px] border-t-[3px] border-[#173f35]/25" /><div className="absolute right-2 top-[16px] h-24 w-1.5 rounded-full bg-[#173f35]/65" /><div className="absolute left-6 top-[71px] flex gap-3"><span className="h-2.5 w-2.5 rounded-full bg-[#173f35]" /><span className="h-2.5 w-2.5 rounded-full bg-[#173f35]" /></div><span className="absolute left-1/2 top-[91px] h-3 w-7 -translate-x-1/2 rounded-b-full border-b-[3px] border-[#173f35]" /><span className="absolute -bottom-3 left-5 h-4 w-3 rounded-b-md bg-[#173f35]" /><span className="absolute -bottom-3 right-5 h-4 w-3 rounded-b-md bg-[#173f35]" /><span className="absolute -left-5 top-20 h-5 w-6 rounded-l-full bg-[#d8eee1]" /><span className="absolute -right-5 top-20 h-5 w-6 rounded-r-full bg-[#d8eee1]" />{phase === "thinking" && <span className="fridge-agent-thought absolute -right-6 top-11 h-3 w-3 rounded-full bg-amber-400" />}{phase === "speaking" && <span className="fridge-agent-voice absolute -right-7 top-[72px] text-lg font-bold text-[#173f35]">)))</span>}</div></div>; }

function stopBrowserSpeech() { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }

function speakReply(text: string, onComplete: () => void) {
  if (!("speechSynthesis" in window)) { onComplete(); return; }
  stopBrowserSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 1;
  utterance.onend = onComplete;
  utterance.onerror = onComplete;
  window.speechSynthesis.speak(utterance);
}

type IconName = "arrow" | "box" | "camera" | "close" | "grid" | "home" | "mic" | "more" | "mute" | "plus" | "sliders" | "speaker";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />, box: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>, camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.2" /></>, close: <path d="m7 7 10 10M17 7 7 17" />, grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>, home: <><path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></>, mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>, mute: <><path d="M5 10v4h4l5 4V6l-5 4z" /><path d="m18 9-5 6" /></>, plus: <path d="M12 5v14M5 12h14" />, sliders: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>, speaker: <><path d="M5 10v4h4l5 4V6l-5 4z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-[1.8]" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
