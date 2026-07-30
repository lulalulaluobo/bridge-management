"use client";

import { useState } from "react";

import type { CredentialSummary } from "@/lib/llm/credentials";

export function LlmSettings({ initialCredentials }: { initialCredentials: CredentialSummary[] }) {
  const [credentials, setCredentials] = useState(initialCredentials);
  const [apiKeys, setApiKeys] = useState<Record<"deepseek" | "qwen", string>>({ deepseek: "", qwen: "" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveKey(event: React.FormEvent<HTMLFormElement>, provider: "deepseek" | "qwen") {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/settings/llm-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKeys[provider] }),
      });
      const data = (await response.json()) as { credential?: CredentialSummary; error?: string };
      if (!response.ok || !data.credential) throw new Error(data.error ?? "无法保存模型 Key");
      setCredentials((current) => orderCredentials([...current.filter((credential) => credential.provider !== data.credential!.provider), data.credential!]));
      setApiKeys((current) => ({ ...current, [provider]: "" }));
      setNotice("模型 Key 已验证并加密保存。页面不会再次显示完整 Key。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存模型 Key");
    } finally {
      setBusy(false);
    }
  }

  async function removeKey(providerToDelete: CredentialSummary["provider"]) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/settings/llm-credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerToDelete }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "无法删除模型 Key");
      }
      setCredentials((current) => current.filter((credential) => credential.provider !== providerToDelete));
      setNotice("模型 Key 已删除，后续智能请求不会再使用它。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法删除模型 Key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-3xl bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold">高级设置：我的模型 Key</summary>
      <p className="mt-2 text-sm leading-6 text-slate-600">Key 仅通过 HTTPS 提交，服务端验证后使用部署密钥加密保存。它不会写入浏览器存储、页面、日志或导出文件。</p>
      {([{ provider: "deepseek", title: "DeepSeek 对话", model: "deepseek-chat", description: "用于文字与语音转写后的 Agent 对话。" }, { provider: "qwen", title: "千问视觉", model: "Qwen-VL-Max", description: "用于拍照识别采购食材，调用千问兼容接口。" }] as const).map((config) => {
        const credential = credentials.find((item) => item.provider === config.provider);
        return <form key={config.provider} className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-3" onSubmit={(event) => void saveKey(event, config.provider)}><div><p className="font-semibold">{config.title}</p><p className="mt-1 text-xs leading-5 text-slate-600">固定模型：{config.model}。{config.description}</p></div>{credential && <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-950"><p>{credential.keyMask} · 已启用</p><button type="button" disabled={busy} onClick={() => removeKey(config.provider)} className="mt-2 font-semibold underline disabled:opacity-50">删除此 Key</button></div>}<label className="grid gap-1 text-sm font-medium">{config.title} API Key<input type="password" autoComplete="off" required minLength={20} value={apiKeys[config.provider]} onChange={(event) => setApiKeys((current) => ({ ...current, [config.provider]: event.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2" placeholder="sk-..." /></label><button disabled={busy} className="rounded-xl bg-[#173f35] px-4 py-3 font-semibold text-white disabled:opacity-50">验证并{credential ? "轮换" : "保存"} Key</button></form>;
      })}
      <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">语音转文字固定使用本地 Paraformer，不需要 Key 或模型设置。</p>
      {notice && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm" role="status">{notice}</p>}
    </details>
  );
}

function orderCredentials(credentials: CredentialSummary[]) {
  return [...credentials].sort((left, right) => {
    if (left.provider === right.provider) return 0;
    if (left.provider === "deepseek") return -1;
    if (right.provider === "deepseek") return 1;
    return left.provider === "qwen" ? -1 : 1;
  });
}
