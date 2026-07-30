"use client";

import { useState } from "react";

import type { CredentialSummary } from "@/lib/llm/credentials";

export function LlmSettings({ initialCredentials }: { initialCredentials: CredentialSummary[] }) {
  const [credentials, setCredentials] = useState(initialCredentials);
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState("gpt-4o-mini");
  const [visionModel, setVisionModel] = useState("gpt-4o-mini");
  const [transcriptionModel, setTranscriptionModel] = useState("gpt-4o-transcribe");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/settings/llm-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey, chatModel, visionModel, transcriptionModel }),
      });
      const data = (await response.json()) as { credential?: CredentialSummary; error?: string };
      if (!response.ok || !data.credential) throw new Error(data.error ?? "无法保存模型 Key");
      setCredentials([data.credential]);
      setApiKey("");
      setNotice("模型 Key 已验证并加密保存。页面不会再次显示完整 Key。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存模型 Key");
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/settings/llm-credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openai" }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "无法删除模型 Key");
      }
      setCredentials([]);
      setNotice("模型 Key 已删除，后续智能请求不会再使用它。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法删除模型 Key");
    } finally {
      setBusy(false);
    }
  }

  const active = credentials[0];
  return (
    <details className="rounded-3xl bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold">高级设置：我的模型 Key</summary>
      <p className="mt-2 text-sm leading-6 text-slate-600">Key 仅通过 HTTPS 提交，服务端验证后使用部署密钥加密保存。它不会写入浏览器存储、页面、日志或导出文件。</p>
      {active && <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-950"><p className="font-semibold">已启用 OpenAI</p><p className="mt-1">{active.keyMask} · 对话：{active.chatModel}</p><button type="button" disabled={busy} onClick={removeKey} className="mt-3 rounded-lg border border-emerald-800 px-3 py-2 font-semibold disabled:opacity-50">删除 Key</button></div>}
      <form className="mt-4 grid gap-3" onSubmit={saveKey}>
        <label className="grid gap-1 text-sm font-medium">OpenAI API Key
          <input type="password" autoComplete="off" required minLength={20} value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" placeholder="sk-..." />
        </label>
        <label className="grid gap-1 text-sm font-medium">对话模型
          <input required value={chatModel} onChange={(event) => setChatModel(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm font-medium">图片识别模型
          <input required value={visionModel} onChange={(event) => setVisionModel(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" />
        </label>
        <label className="grid gap-1 text-sm font-medium">语音转写模型
          <input required value={transcriptionModel} onChange={(event) => setTranscriptionModel(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" />
        </label>
        <button disabled={busy} className="rounded-xl bg-[#173f35] px-4 py-3 font-semibold text-white disabled:opacity-50">验证并{active ? "轮换" : "保存"} Key</button>
      </form>
      {notice && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm" role="status">{notice}</p>}
    </details>
  );
}
