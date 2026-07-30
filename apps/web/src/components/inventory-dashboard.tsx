"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LlmSettings } from "@/components/llm-settings";
import { AgentWriteSettings } from "@/components/agent-write-settings";
import { AccountSettings } from "@/components/account-settings";
import { MealRecommendationCards, MealRecommendations } from "@/components/meal-recommendations";
import { NotificationControl } from "@/components/notification-control";
import { ShelfLifeSettings } from "@/components/shelf-life-settings";
import { foodCategories, storageLocations, type FoodBatchWithStatus, type OperationProposal, type ProposalAction } from "@/lib/inventory/types";
import type { CredentialSummary } from "@/lib/llm/credentials";
import type { FoodCandidate } from "@/lib/media/recognition";
import type { FoodPreferences } from "@/lib/preferences";
import type { MealRecommendations as MealRecommendationsData } from "@/lib/recipes";

type AddForm = { name: string; category: (typeof foodCategories)[number]; quantity: string; unit: string; purchasedAt: string; storageLocation: (typeof storageLocations)[number]; opened: boolean };
type Tab = "today" | "inventory" | "history" | "more";
type HistoryItem = { id: string; action: ProposalAction; changedBatchIds: string[]; source: "agent" | "manual"; createdAt: string };
type BatchChanges = Extract<ProposalAction, { type: "update_batch" }>["changes"];
type AgentPhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
type ChatMessage = { id: string; role: "assistant" | "user"; content: string; status: "pending" | "committed" };

const todayValue = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const initialForm: AddForm = { name: "", category: "其他", quantity: "1", unit: "份", purchasedAt: todayValue, storageLocation: "冷藏室", opened: false };

export function InventoryDashboard({ username, initialBatches, initialCredentials, initialPreferences, vapidPublicKey }: { username: string; initialBatches: FoodBatchWithStatus[]; initialCredentials: CredentialSummary[]; initialPreferences: FoodPreferences; vapidPublicKey: string }) {
  const [batches, setBatches] = useState(initialBatches);
  const [form, setForm] = useState<AddForm>(initialForm);
  const [photoCandidates, setPhotoCandidates] = useState<FoodCandidate[] | null>(null);
  const [photoRecommendations, setPhotoRecommendations] = useState<MealRecommendationsData | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingBatch, setEditingBatch] = useState<FoodBatchWithStatus | null>(null);
  const [agentProposal, setAgentProposal] = useState<OperationProposal | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "assistant", content: "你好，我会记住冰箱里的东西，也会提醒你先吃什么。", status: "committed" }]);
  const conversationId = useRef("");
  if (!conversationId.current) conversationId.current = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (tab !== "today") return;
    const { overflow } = document.documentElement.style;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = overflow; document.body.style.overflow = bodyOverflow; };
  }, [tab]);

  async function loadInventory() { const response = await fetch("/api/inventory", { cache: "no-store" }); const data = await response.json() as { batches: FoodBatchWithStatus[] }; setBatches(data.batches); }
  async function loadHistory() { const response = await fetch("/api/history", { cache: "no-store" }); const data = await response.json() as { items?: HistoryItem[] }; if (response.ok) setHistory(data.items ?? []); }
  useEffect(() => { if (tab === "history") void loadHistory(); }, [tab]);
  async function queueAction(action: ProposalAction) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, idempotencyKey: crypto.randomUUID() }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "无法写入库存");
      setShowAdd(false); setForm(initialForm); setNotice("已更新库存"); await loadInventory();
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法写入库存"); } finally { setBusy(false); }
  }
  async function createPreview(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); await queueAction({ type: "add_batches", batches: [{ ...form, quantity: Number(form.quantity) }] }); }
  async function askAgent(message: string) {
    stopBrowserSpeech(); setBusy(true); setNotice(""); setAgentPhase("thinking");
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, conversationId: conversationId.current, idempotencyKey: crypto.randomUUID() }) });
      const data = await response.json() as { message?: string; speech?: string; proposal?: OperationProposal | null; committed?: unknown; history?: ChatMessage[]; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error ?? "Agent 暂时无法回复");
      if (data.history) setMessages(data.history);
      if (voiceReplies) {
        setAgentPhase("speaking");
        speakReply(data.speech ?? data.message!, () => setAgentPhase((phase) => phase === "speaking" ? "idle" : phase));
      } else setAgentPhase("idle");
      if (data.proposal) setAgentProposal(data.proposal);
      if (data.committed) await loadInventory();
    } catch (error) { setAgentPhase("idle"); setMessages((items) => [...items, { id: crypto.randomUUID(), role: "assistant", content: error instanceof Error ? error.message : "Agent 暂时无法回复", status: "pending" }]); } finally { setBusy(false); }
  }
  async function confirmAgentProposal() {
    if (!agentProposal) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/proposals/${agentProposal.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), conversationId: conversationId.current }) });
      const data = await response.json() as { error?: string; history?: ChatMessage[] };
      if (!response.ok) throw new Error(data.error ?? "无法写入库存");
      if (data.history) setMessages(data.history); else setMessages((items) => items.map((item) => item.status === "pending" ? { ...item, status: "committed" } : item));
      setAgentProposal(null); setNotice("已写入库存"); await loadInventory();
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法写入库存"); } finally { setBusy(false); }
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
  async function recommendFromPhoto(candidates: FoodCandidate[]) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/recommendations/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidates }) });
      const data = (await response.json()) as { recommendations?: MealRecommendationsData; error?: string };
      if (!response.ok || !data.recommendations) throw new Error(data.error ?? "暂时无法根据照片推荐菜式");
      setPhotoCandidates(null); setPhotoRecommendations(data.recommendations);
    } catch (error) { setNotice(error instanceof Error ? error.message : "暂时无法根据照片推荐菜式"); } finally { setBusy(false); }
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

  return <main className={tab === "today" ? "h-[100dvh] overflow-hidden bg-[#f3f4f0] text-[#17231f]" : "min-h-[100dvh] bg-[#f3f4f0] pb-36 text-[#17231f]"}>
    <div className={`mx-auto w-full max-w-xl px-5 pt-[max(1.2rem,env(safe-area-inset-top))] ${tab === "today" ? "h-full" : ""}`}>
      {tab === "today" && <TodayView messages={messages} notice={notice} chatInput={chatInput} busy={busy} agentPhase={agentPhase} setAgentPhase={setAgentPhase} setChatInput={setChatInput} sendMessage={sendMessage} recognizeImage={recognizeImage} transcribe={transcribeAndSend} voiceError={setNotice} voiceReplies={voiceReplies} toggleVoiceReplies={toggleVoiceReplies} openAdd={() => setShowAdd(true)} />}
      {tab === "inventory" && <InventoryView batches={batches} onAdd={() => setShowAdd(true)} onConsume={consume} onSetOpened={(batch, opened) => void queueAction({ type: "update_batch", batchId: batch.id, changes: { opened } })} onEditStart={setEditingBatch} onDelete={(batch) => void queueAction({ type: "soft_delete_batch", batchId: batch.id })} />}
      {tab === "history" && <HistoryView items={history} />}
      {tab === "more" && <MoreView username={username} initialCredentials={initialCredentials} initialPreferences={initialPreferences} vapidPublicKey={vapidPublicKey} />}
    </div>
    {notice && tab !== "today" && <p role="status" className="fixed inset-x-5 top-[max(1rem,env(safe-area-inset-top))] z-40 mx-auto max-w-md rounded-full bg-white/95 px-4 py-2 text-center text-sm font-medium text-[#405148] shadow-lg backdrop-blur-xl">{notice}</p>}
    {showAdd && <AddSheet form={form} setForm={setForm} busy={busy} onClose={() => setShowAdd(false)} onSubmit={createPreview} />}
    {editingBatch && <EditBatchSheet batch={editingBatch} busy={busy} onClose={() => setEditingBatch(null)} onSubmit={(changes) => { setEditingBatch(null); void queueAction({ type: "update_batch", batchId: editingBatch.id, changes }); }} />}
    {agentProposal && <AgentConfirmSheet proposal={agentProposal} busy={busy} onCancel={() => setAgentProposal(null)} onConfirm={() => void confirmAgentProposal()} />}
    {photoCandidates && <PhotoCandidatesSheet candidates={photoCandidates} busy={busy} onClose={() => setPhotoCandidates(null)} onRecommend={(candidates) => void recommendFromPhoto(candidates)} onContinue={(candidates) => { setPhotoCandidates(null); void queueAction({ type: "add_batches", batches: candidates.map((item) => ({ ...item, purchasedAt: todayValue })) }); }} />}
    {photoRecommendations && <Sheet title="这些食材可以做什么？" onClose={() => setPhotoRecommendations(null)}><p className="-mt-2 text-sm leading-5 text-[#64736c]">照片食材尚未写入库存；以下建议仅供决定是否入库或做菜。</p><MealRecommendationCards recommendations={photoRecommendations} /></Sheet>}
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-[#f7f8f5]/90 px-5 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl"><div className="mx-auto grid max-w-xl grid-cols-4"><TabButton active={tab === "today"} label="今天" icon="home" onClick={() => setTab("today")} /><TabButton active={tab === "inventory"} label="库存" icon="grid" onClick={() => setTab("inventory")} /><TabButton active={tab === "history"} label="记录" icon="history" onClick={() => setTab("history")} /><TabButton active={tab === "more"} label="更多" icon="sliders" onClick={() => setTab("more")} /></div></nav>
  </main>;
}

function TodayView({ messages, notice, chatInput, busy, agentPhase, setAgentPhase, setChatInput, sendMessage, recognizeImage, transcribe, voiceError, voiceReplies, toggleVoiceReplies, openAdd }: { messages: Array<{ role: "assistant" | "user"; content: string }>; notice: string; chatInput: string; busy: boolean; agentPhase: AgentPhase; setAgentPhase: (phase: AgentPhase) => void; setChatInput: (value: string) => void; sendMessage: (event: React.FormEvent<HTMLFormElement>) => void; recognizeImage: (file: File) => void; transcribe: (audio: Blob) => void; voiceError: (message: string) => void; voiceReplies: boolean; toggleVoiceReplies: () => void; openAdd: () => void }) {
  const latestReply = [...messages].reverse().find((message) => message.role === "assistant")?.content;
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content;
  const statusText: Record<AgentPhase, string> = { idle: notice || latestReply || "你好，我会记住冰箱里的东西，也会提醒你先吃什么。", listening: "我在听。", transcribing: "正在识别语音…", thinking: "让我看看该怎么处理。", speaking: latestReply ?? "我来告诉你。" };
  return <><section className="mt-2 flex items-center justify-between"><h1 className="text-[25px] font-bold tracking-[-.045em]">冰箱小精灵</h1><button type="button" onClick={toggleVoiceReplies} className="grid h-11 w-11 place-items-center rounded-full bg-white text-[#173f35] shadow-[0_5px_16px_rgba(23,63,53,.08)] active:scale-95" aria-label={voiceReplies ? "停止并关闭语音回复" : "开启语音回复"} title={voiceReplies ? "停止并关闭语音回复" : "开启语音回复"}><Icon name={voiceReplies ? "speaker" : "mute"} /></button></section>
    <section className="relative mx-auto mt-3 flex h-[calc(100dvh-12.5rem)] min-h-0 max-w-sm flex-col items-center justify-center pb-14"><div aria-live="polite" className="relative z-10 max-w-[19rem] whitespace-pre-line rounded-[24px] bg-white px-4 py-3 text-[15px] leading-6 text-[#25332d] shadow-[0_8px_28px_rgba(23,63,53,.10)] after:absolute after:bottom-[-8px] after:left-1/2 after:h-4 after:w-4 after:-translate-x-1/2 after:rotate-45 after:bg-white">{statusText[agentPhase]}</div>{latestUserMessage && agentPhase !== "idle" && <p className="mt-4 max-w-[17rem] truncate rounded-full bg-[#e1ebe5] px-3 py-1.5 text-sm text-[#405148]">你：{latestUserMessage}</p>}<FridgeSprite phase={agentPhase} listening={agentPhase === "listening"} /><div className="absolute bottom-20"><VoiceButton hero disabled={busy && agentPhase !== "speaking"} phase={agentPhase} onAudio={transcribe} onError={voiceError} onPhaseChange={setAgentPhase} /></div></section>
    <form onSubmit={sendMessage} className="fixed inset-x-5 bottom-[calc(4.8rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[calc(36rem-2.5rem)] items-center gap-2 rounded-[22px] border border-white/80 bg-white/95 p-2 shadow-[0_10px_30px_rgba(23,63,53,.14)] backdrop-blur-xl"><button type="button" onClick={openAdd} disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-[16px] bg-[#dcece3] text-[#173f35] active:scale-95 disabled:opacity-50" aria-label="手动添加食材"><Icon name="plus" /></button><label className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-[16px] bg-[#edf0eb] text-[#173f35] active:scale-95 ${busy ? "pointer-events-none opacity-50" : ""}`} aria-label="拍照识别"><Icon name="camera" /><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void recognizeImage(file); event.currentTarget.value = ""; }} /></label><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] outline-none" placeholder="输入文字…" /><button disabled={busy || !chatInput.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-[16px] bg-[#173f35] text-white disabled:opacity-40" aria-label="发送"><Icon name="arrow" /></button></form></>;
}

function InventoryView({ batches, onAdd, onConsume, onSetOpened, onEditStart, onDelete }: { batches: FoodBatchWithStatus[]; onAdd: () => void; onConsume: (batch: FoodBatchWithStatus) => void; onSetOpened: (batch: FoodBatchWithStatus, opened: boolean) => void; onEditStart: (batch: FoodBatchWithStatus) => void; onDelete: (batch: FoodBatchWithStatus) => void }) {
  const [groupBy, setGroupBy] = useState<"all" | "category" | "location">("all");
  const sorted = useMemo(() => [...batches].sort((left, right) => left.expiresAt.localeCompare(right.expiresAt) || left.name.localeCompare(right.name, "zh-CN")), [batches]);
  const sections = groupBy === "all" ? [{ label: "按预计过期日", batches: sorted }] : Object.entries(sorted.reduce<Record<string, FoodBatchWithStatus[]>>((result, batch) => { const key = groupBy === "category" ? batch.category : batch.storageLocation; (result[key] ??= []).push(batch); return result; }, {})).sort(([left], [right]) => left.localeCompare(right, "zh-CN")).map(([label, items]) => ({ label, batches: items }));
  return <section className="mt-7"><div className="flex items-center justify-between"><div><h2 className="text-[25px] font-bold tracking-[-.04em]">库存</h2><p className="mt-1 text-sm text-[#6f8178]">{batches.length} 个采购批次 · 临期优先</p></div><button type="button" onClick={onAdd} className="grid h-11 w-11 place-items-center rounded-full bg-[#173f35] text-white shadow-lg active:scale-95" aria-label="手动入库"><Icon name="plus" /></button></div>{batches.length === 0 ? <EmptyInventory onAdd={onAdd} /> : <><div className="mt-5 grid grid-cols-3 rounded-2xl bg-[#e8ece7] p-1 text-sm font-semibold">{(["all", "category", "location"] as const).map((item) => <button key={item} type="button" onClick={() => setGroupBy(item)} className={`rounded-xl py-2 transition ${groupBy === item ? "bg-white text-[#173f35] shadow-sm" : "text-[#718078]"}`}>{{ all: "全部", category: "类别", location: "位置" }[item]}</button>)}</div><div className="mt-4 grid gap-4">{sections.map((section) => <section key={section.label}>{groupBy !== "all" && <p className="mb-2 px-1 text-sm font-semibold text-[#6f8178]">{section.label}</p>}<div className="overflow-hidden rounded-[22px] bg-white shadow-[0_3px_14px_rgba(23,63,53,.05)]">{section.batches.map((batch, index) => <BatchRow key={batch.id} batch={batch} first={index === 0} onConsume={() => onConsume(batch)} onSetOpened={(opened) => onSetOpened(batch, opened)} onEdit={() => onEditStart(batch)} onDelete={() => onDelete(batch)} />)}</div></section>)}</div></>}</section>;
}

function MoreView({ username, initialCredentials, initialPreferences, vapidPublicKey }: { username: string; initialCredentials: CredentialSummary[]; initialPreferences: FoodPreferences; vapidPublicKey: string }) { return <section className="mt-7 grid gap-5"><div><h2 className="text-[25px] font-bold tracking-[-.04em]">更多</h2><p className="mt-1 text-sm text-[#6f8178]">偏好、提醒与模型设置</p></div><AccountSettings username={username} /><AgentWriteSettings /><MealRecommendations initialPreferences={initialPreferences} /><NotificationControl vapidPublicKey={vapidPublicKey} /><ShelfLifeSettings /><LlmSettings initialCredentials={initialCredentials} /></section>; }

function HistoryView({ items }: { items: HistoryItem[] }) { return <section className="mt-7"><h2 className="text-[25px] font-bold tracking-[-.04em]">操作记录</h2><p className="mt-1 text-sm text-[#6f8178]">全家共享；可核对 Agent 实际执行的写库操作。</p><div className="mt-5 overflow-hidden rounded-[24px] bg-white shadow-[0_3px_14px_rgba(23,63,53,.05)]">{items.length ? items.map((item, index) => <article key={item.id} className={`px-4 py-3 ${index ? "border-t border-[#edf0eb]" : ""}`}><div className="flex items-center justify-between gap-3"><p className="font-semibold">{historySummary(item.action)}</p><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.source === "agent" ? "bg-[#dcece3] text-[#173f35]" : "bg-[#eef1ee] text-[#66756d]"}`}>{item.source === "agent" ? "Agent" : "手动"}</span></div><p className="mt-1 text-xs text-[#74827a]">{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.createdAt))}</p></article>) : <p className="px-5 py-10 text-center text-sm text-[#74827a]">还没有操作记录。</p>}</div></section>; }
function historySummary(action: ProposalAction) { if (action.type === "add_batches") return `入库：${action.batches.map((batch) => `${batch.name}${batch.quantity}${batch.unit}`).join("、")}`; if (action.type === "consume_batch") return "记录了食材消耗"; if (action.type === "soft_delete_batch") return "移除了一个库存批次"; return "修改了库存信息"; }

function AddSheet({ form, setForm, busy, onClose, onSubmit }: { form: AddForm; setForm: (value: AddForm) => void; busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <Sheet title="添加食材" onClose={onClose}><form className="grid gap-4" onSubmit={onSubmit}><Field label="食物名称"><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：菠菜" /></Field><div className="grid grid-cols-2 gap-3"><Field label="数量"><input required min="0.01" step="0.01" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="单位"><input required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="类别"><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as AddForm["category"] })}>{foodCategories.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="存放位置"><select value={form.storageLocation} onChange={(event) => setForm({ ...form, storageLocation: event.target.value as AddForm["storageLocation"] })}>{storageLocations.map((item) => <option key={item}>{item}</option>)}</select></Field></div><Field label="购买日期"><input required type="date" value={form.purchasedAt} onChange={(event) => setForm({ ...form, purchasedAt: event.target.value })} /></Field><label className="flex items-center gap-3 rounded-2xl bg-[#f3f4f0] px-4 py-3 text-sm font-medium"><input type="checkbox" checked={form.opened} onChange={(event) => setForm({ ...form, opened: event.target.checked })} /> 已开封</label><button disabled={busy} className="mt-1 rounded-2xl bg-[#173f35] py-4 font-semibold text-white shadow-lg disabled:opacity-50">直接入库</button></form></Sheet>; }

function EditBatchSheet({ batch, busy, onClose, onSubmit }: { batch: FoodBatchWithStatus; busy: boolean; onClose: () => void; onSubmit: (changes: BatchChanges) => void }) {
  const [form, setForm] = useState({ name: batch.name, category: batch.category, quantity: String(batch.quantity), unit: batch.unit, purchasedAt: batch.purchasedAt, expiresAt: batch.expiresAt, storageLocation: batch.storageLocation, opened: batch.opened });
  return <Sheet compact title="编辑食材" onClose={onClose}><form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); const quantity = Number(form.quantity); if (Number.isFinite(quantity) && quantity > 0) onSubmit({ ...form, quantity }); }}><Field label="名称"><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="数量"><input required min="0.01" step="0.01" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></Field><Field label="单位"><input required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="类别"><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as FoodBatchWithStatus["category"] })}>{foodCategories.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="位置"><select value={form.storageLocation} onChange={(event) => setForm({ ...form, storageLocation: event.target.value as FoodBatchWithStatus["storageLocation"] })}>{storageLocations.map((item) => <option key={item}>{item}</option>)}</select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="购买日期"><input required type="date" value={form.purchasedAt} onChange={(event) => setForm({ ...form, purchasedAt: event.target.value })} /></Field><Field label="预计过期"><input required type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></Field></div><label className="flex items-center gap-3 rounded-2xl bg-[#f3f4f0] px-4 py-3 text-sm font-medium"><input type="checkbox" checked={form.opened} onChange={(event) => setForm({ ...form, opened: event.target.checked })} /> 已开封</label><button disabled={busy} className="rounded-2xl bg-[#173f35] py-3.5 font-semibold text-white disabled:opacity-50">保存修改</button></form></Sheet>;
}

function AgentConfirmSheet({ proposal, busy, onCancel, onConfirm }: { proposal: OperationProposal; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (proposal.action.type !== "add_batches") return null;
  return <Sheet compact bottom title="确认入库" onClose={onCancel}><p className="-mt-2 text-sm leading-5 text-[#64736c]">语音自动入库已关闭。确认后才会写入本次候选食材。</p><div className="mt-4 grid max-h-[25dvh] gap-2 overflow-y-auto">{proposal.action.batches.map((batch, index) => <div key={`${batch.name}-${index}`} className="rounded-2xl bg-[#f3f4f0] px-3 py-2.5 text-sm"><span className="font-semibold">{batch.name} {batch.quantity}{batch.unit}</span><span className="ml-2 text-[#65746c]">{batch.storageLocation}</span></div>)}</div><div className="mt-4 grid grid-cols-2 gap-3"><button type="button" disabled={busy} onClick={onCancel} className="rounded-2xl bg-[#edf0eb] py-3 font-semibold">暂不入库</button><button type="button" disabled={busy} onClick={onConfirm} className="rounded-2xl bg-[#173f35] py-3 font-semibold text-white disabled:opacity-50">确认入库</button></div></Sheet>;
}

function PhotoCandidatesSheet({ candidates, busy, onClose, onContinue, onRecommend }: { candidates: FoodCandidate[]; busy: boolean; onClose: () => void; onContinue: (candidates: FoodCandidate[]) => void; onRecommend: (candidates: FoodCandidate[]) => void }) {
  const [items, setItems] = useState(candidates);
  function update(index: number, changes: Partial<FoodCandidate>) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item)); }
  return <Sheet title="核对照片里的食材" onClose={onClose}><p className="-mt-2 mb-4 text-sm leading-5 text-[#64736c]">识别结果仅是候选。可先看看能做什么，或修改后直接入库。</p><div className="grid max-h-[48dvh] gap-3 overflow-y-auto pr-1">{items.map((item, index) => <article key={`${item.name}-${index}`} className="rounded-2xl bg-[#f0f2ed] p-3"><div className="flex gap-2"><input aria-label={`食材名称 ${index + 1}`} value={item.name} onChange={(event) => update(index, { name: event.target.value })} className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold" /><button type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl bg-white px-3 text-xs font-semibold text-rose-700" aria-label={`删除 ${item.name}`}>删除</button></div><div className="mt-2 grid grid-cols-2 gap-2"><input aria-label={`数量 ${item.name}`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => update(index, { quantity: Number(event.target.value) })} className="rounded-xl bg-white px-3 py-2 text-sm" /><input aria-label={`单位 ${item.name}`} value={item.unit} onChange={(event) => update(index, { unit: event.target.value })} className="rounded-xl bg-white px-3 py-2 text-sm" /><select aria-label={`类别 ${item.name}`} value={item.category} onChange={(event) => update(index, { category: event.target.value as FoodCandidate["category"] })} className="rounded-xl bg-white px-3 py-2 text-sm">{foodCategories.map((category) => <option key={category}>{category}</option>)}</select><select aria-label={`位置 ${item.name}`} value={item.storageLocation} onChange={(event) => update(index, { storageLocation: event.target.value as FoodCandidate["storageLocation"] })} className="rounded-xl bg-white px-3 py-2 text-sm">{storageLocations.map((location) => <option key={location}>{location}</option>)}</select></div></article>)}</div><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" disabled={busy || !items.length} onClick={() => onRecommend(items)} className="rounded-2xl bg-[#eef0eb] py-3 font-semibold text-[#173f35] disabled:opacity-50">{busy ? "正在搭配…" : "看看能做什么"}</button><button type="button" disabled={busy || !items.length} onClick={() => onContinue(items)} className="rounded-2xl bg-[#173f35] py-3 font-semibold text-white disabled:opacity-50">直接入库</button></div></Sheet>;
}

function BatchRow({ batch, first, onConsume, onSetOpened, onEdit, onDelete }: { batch: FoodBatchWithStatus; first: boolean; onConsume: () => void; onSetOpened: (opened: boolean) => void; onEdit: () => void; onDelete: () => void }) {
  const pointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const swipeOffset = useRef(0);
  const didSwipe = useRef(false);
  const [offset, setOffset] = useState(0);
  const status = batch.status === "expired" ? "已过期" : batch.status === "expiring" ? "快过期" : "正常";
  const tone = batch.status === "expired" ? "bg-rose-100 text-rose-800" : batch.status === "expiring" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800";
  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) { pointerStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }; didSwipe.current = false; event.currentTarget.setPointerCapture(event.pointerId); }
  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) { if (!pointerStart.current || pointerStart.current.pointerId !== event.pointerId) return; const horizontal = event.clientX - pointerStart.current.x; const vertical = event.clientY - pointerStart.current.y; if (Math.abs(horizontal) <= 10 || Math.abs(horizontal) <= Math.abs(vertical)) return; didSwipe.current = true; swipeOffset.current = Math.max(-76, Math.min(76, horizontal)); setOffset(swipeOffset.current); }
  function resetSwipe() { pointerStart.current = null; swipeOffset.current = 0; setOffset(0); }
  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) { if (!pointerStart.current || pointerStart.current.pointerId !== event.pointerId) return; const finalOffset = swipeOffset.current; if (finalOffset <= -44) onSetOpened(true); if (finalOffset >= 44) onSetOpened(false); window.setTimeout(resetSwipe, 80); }
  return <article className={`relative ${first ? "" : "border-t border-[#edf0eb]"} bg-[#f4f6f3]`}><div className="absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-[#617068]">未开封</div><div className="absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-[#8d5a10]">开封</div><div className="relative flex items-center gap-2 bg-white px-4 py-3 will-change-transform" style={{ transform: `translateX(${offset}px)` }}><button type="button" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={resetSwipe} onClick={() => { if (!didSwipe.current) onEdit(); }} className="min-w-0 flex-1 touch-pan-y text-left active:opacity-65" aria-label={`编辑 ${batch.name}；左滑开封，右滑未开封`}><span className="flex items-center gap-1.5"><span className="truncate font-semibold tracking-[-.015em]">{batch.name}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{status}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${batch.opened ? "bg-[#fce8cd] text-[#995f13]" : "bg-[#eef1ee] text-[#758278]"}`}>{batch.opened ? "已开封" : "未开封"}</span></span><span className="mt-1 block truncate text-sm text-[#66756d]">{batch.quantity}{batch.unit} · {batch.storageLocation} · {batch.expiresAt}到期</span></button><div className="flex shrink-0 items-center gap-1"><ActionIcon label={`编辑 ${batch.name}`} icon="pencil" onClick={onEdit} /><ActionIcon label={`消耗 ${batch.name}`} icon="consume" onClick={onConsume} /><ActionIcon label={`删除 ${batch.name}`} icon="trash" onClick={onDelete} danger /></div></div></article>;
}

function ActionIcon({ label, icon, onClick, danger = false }: { label: string; icon: IconName; onClick: () => void; danger?: boolean }) { return <button type="button" onClick={onClick} aria-label={label} className={`grid h-9 w-9 touch-manipulation place-items-center rounded-full bg-[#eff2ee] transition-[transform,background-color] duration-100 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173f35] ${danger ? "text-rose-700 active:bg-rose-100" : "text-[#405148] active:bg-[#dcece3]"}`}><Icon name={icon} /></button>; }

function Sheet({ title, onClose, children, compact = false, bottom = false }: { title: string; onClose: () => void; children: React.ReactNode; compact?: boolean; bottom?: boolean }) { return <div className={`fixed inset-0 z-50 flex justify-center bg-[#17231f]/20 px-4 backdrop-blur-[2px] ${bottom ? "items-end pb-[max(1rem,env(safe-area-inset-bottom))]" : "items-start pt-[max(1rem,env(safe-area-inset-top))]"}`} role="dialog" aria-modal="true"><section className={`${compact ? "max-h-[52dvh]" : "max-h-[calc(100dvh-2rem)]"} w-full max-w-md overflow-y-auto rounded-[26px] border border-white/70 bg-[#fbfcf9]/[.98] px-5 py-4 shadow-[0_18px_48px_rgba(23,63,53,.22)] backdrop-blur-xl`}><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold tracking-[-.03em]">{title}</h2><button type="button" onClick={onClose} className="grid h-9 w-9 touch-manipulation place-items-center rounded-full bg-[#eef0eb] transition-transform duration-100 active:scale-90" aria-label="关闭"><Icon name="close" /></button></div>{children}</section></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-semibold text-[#53635b]">{label}<span className="[&_input]:w-full [&_input]:rounded-xl [&_input]:border-0 [&_input]:bg-[#f0f2ed] [&_input]:px-3 [&_input]:py-3 [&_select]:w-full [&_select]:rounded-xl [&_select]:border-0 [&_select]:bg-[#f0f2ed] [&_select]:px-3 [&_select]:py-3">{children}</span></label>; }
function TabButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: IconName; onClick: () => void }) { return <button type="button" onClick={onClick} aria-label={label} title={label} className={`grid justify-items-center py-1 ${active ? "text-[#173f35]" : "text-[#819088]"}`}><span className={`grid h-9 w-12 place-items-center rounded-full ${active ? "bg-[#dcece3]" : ""}`}><Icon name={icon} /></span></button>; }
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
  if (hero) return <button type="button" disabled={disabled} onPointerDown={armOrStart} onPointerMove={cancelArmOnMove} onPointerUp={stop} onPointerCancel={stop} className={`relative mt-4 grid h-20 w-20 place-items-center rounded-full border-4 border-white bg-[#173f35] text-white shadow-[0_14px_30px_rgba(23,63,53,.24)] outline-none transition-transform active:scale-95 disabled:opacity-60 ${listening ? "fridge-agent-listening bg-rose-500" : phase === "thinking" ? "fridge-agent-thinking" : phase === "speaking" ? "fridge-agent-speaking" : ""}`} aria-label={listening ? "正在聆听，松开后发送" : phase === "speaking" ? "按住半秒打断回复并开始说话" : disabled ? "正在整理语音" : "按住 Live 按钮说话"}><span className={`absolute inset-[-11px] rounded-full border-2 ${listening ? "border-rose-300 animate-ping" : "border-[#d2e5da]"}`} /><Icon name="mic" size="h-8 w-8" /></button>;
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

type IconName = "arrow" | "box" | "camera" | "close" | "consume" | "grid" | "history" | "home" | "mic" | "mute" | "pencil" | "plus" | "sliders" | "speaker" | "trash";
function Icon({ name, size = "h-5 w-5" }: { name: IconName; size?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />, box: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>, camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.2" /></>, close: <path d="m7 7 10 10M17 7 7 17" />, consume: <><path d="M5 9h14l-1 10H6z" /><path d="M8 9a4 4 0 0 1 8 0M12 13v3" /></>, grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>, history: <><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v5h5M12 7v5l3 2" /></>, home: <><path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></>, mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>, mute: <><path d="M5 10v4h4l5 4V6l-5 4z" /><path d="m18 9-5 6" /></>, pencil: <><path d="m4 20 4.2-1 10.3-10.3a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20z" /><path d="m13.8 7.8 2.8 2.8" /></>, plus: <path d="M12 5v14M5 12h14" />, sliders: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>, speaker: <><path d="M5 10v4h4l5 4V6l-5 4z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></>, trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${size} fill-none stroke-current stroke-[1.8]`} strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
