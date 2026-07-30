"use client";

import { useEffect, useState } from "react";

import { providerDefaults, type CredentialSummary, type Provider } from "@/lib/llm/credentials";

const PROVIDERS = Object.keys(providerDefaults) as Provider[];

export function LlmSettings({ onBack }: { onBack?: () => void }) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<Provider>("qwen");
  const [model, setModel] = useState<string>(providerDefaults.qwen.defaultModel);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/settings/llm-credentials");
        const data = (await response.json()) as { credentials?: CredentialSummary[] };
        if (!cancelled && data.credentials) setCredentials(data.credentials);
      } catch { /* 忽略 */ } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function resetForm() { setApiKey(""); setLabel(""); }

  function chooseProvider(next: Provider) {
    setProvider(next);
    setModel(providerDefaults[next].defaultModel);
    setBaseUrl(next === "custom" ? "" : providerDefaults[next].baseURL ?? "");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/settings/llm-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, model, label: label || undefined, baseUrl: provider === "custom" ? baseUrl : undefined }),
      });
      const data = (await response.json()) as { credential?: CredentialSummary; error?: string };
      if (!response.ok || !data.credential) throw new Error(data.error ?? "无法保存模型配置");
      setCredentials((current) => current.map((item) => ({ ...item, isActive: false })).some((item) => item.id === data.credential!.id)
        ? current.map((item) => (item.id === data.credential!.id ? data.credential! : item))
        : [data.credential!, ...current]);
      resetForm();
      setNotice(`已保存并启用：${data.credential.label}（${data.credential.chatModel}）`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法保存模型配置");
    } finally { setBusy(false); }
  }

  async function activate(id: string) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/settings/llm-credentials", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "activate" }) });
      const data = (await response.json()) as { credential?: CredentialSummary; error?: string };
      if (!response.ok || !data.credential) throw new Error(data.error ?? "无法切换启用项");
      setCredentials((current) => current.map((item) => ({ ...item, isActive: item.id === data.credential!.id })));
      setNotice(`已切换启用：${data.credential.label}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法切换启用项"); } finally { setBusy(false); }
  }

  async function remove(id: string, displayName: string) {
    if (!window.confirm(`确定删除「${displayName}」的模型配置吗？`)) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/settings/llm-credentials", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) { const data = (await response.json()) as { error?: string }; throw new Error(data.error ?? "无法删除模型配置"); }
      setCredentials((current) => {
        const filtered = current.filter((item) => item.id !== id);
        const nextActive = filtered.find((item) => item.isActive) ?? filtered[0];
        return filtered.map((item) => ({ ...item, isActive: item.id === nextActive?.id }));
      });
      setNotice("已删除该模型配置");
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法删除模型配置"); } finally { setBusy(false); }
  }

  return (
    <section className="mt-7">
      {onBack && (
        <button type="button" onClick={onBack} className="fixed bottom-24 left-4 z-50 flex items-center gap-2 rounded-full border border-white/40 bg-[#173f35]/90 px-4 py-2.5 text-xs font-bold text-white shadow-[0_8px_24px_rgba(23,63,53,.35)] backdrop-blur-xl transition active:scale-95">
          <span className="text-sm font-black">←</span><span>返回</span>
        </button>
      )}
      <div><h2 className="text-[25px] font-bold tracking-[-.04em] text-[#17231f]">模型设置</h2><p className="mt-0.5 text-sm text-[#6f8178]">保存一条模型配置即同时用于对话与拍照识别。</p></div>

      <div className="mt-5 rounded-[24px] bg-white p-4 shadow-[0_3px_14px_rgba(23,63,53,.05)]">
        <p className="text-xs leading-5 text-[#64736c]">请选择一个支持视觉（多模态）的模型，例如 Qwen-VL、GPT-4o。Key 仅经 HTTPS 提交，服务端验证后加密保存，不会写入浏览器、日志或导出文件。语音转写优先用本地服务，仅 OpenAI 可作云端兜底。</p>
        <form className="mt-4 grid gap-4" onSubmit={save}>
          <Field label="模型供应商">
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((item) => (
                <button key={item} type="button" onClick={() => chooseProvider(item)} className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${provider === item ? "bg-[#173f35] text-white shadow-sm" : "bg-[#f0f2ed] text-[#53635b]"}`}>
                  {providerDefaults[item].title}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[#74827a]">{providerDefaults[provider].description}</p>
          </Field>
          <Field label="模型名">
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={providerDefaults[provider].defaultModel || "如 qwen-vl-max"} />
          </Field>
          <Field label="备注名（可选）">
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="如 我的千问主号" />
          </Field>
          {provider === "custom" && (
            <Field label="Base URL（自定义兼容端点）">
              <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="如 https://openrouter.ai/api/v1" />
            </Field>
          )}
          <Field label="API Key">
            <input type="password" autoComplete="off" required minLength={20} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
          </Field>
          <button disabled={busy} className="rounded-2xl bg-[#173f35] py-3.5 font-semibold text-white shadow-lg disabled:opacity-50">{busy ? "验证中…" : "验证并保存（自动启用）"}</button>
        </form>
      </div>

      <div className="mt-5">
        <h3 className="px-1 text-sm font-semibold text-[#6f8178]">已保存的模型（{credentials.length}）</h3>
        {loading ? (
          <p className="mt-3 rounded-[22px] bg-white px-5 py-8 text-center text-sm text-[#74827a] shadow-[0_3px_14px_rgba(23,63,53,.05)]">加载中…</p>
        ) : credentials.length === 0 ? (
          <p className="mt-3 rounded-[22px] bg-white px-5 py-10 text-center text-sm text-[#74827a] shadow-[0_3px_14px_rgba(23,63,53,.05)]">还没有保存的模型配置。</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {credentials.map((item) => (
              <article key={item.id} className={`rounded-[22px] bg-white p-4 shadow-[0_3px_14px_rgba(23,63,53,.05)] ${item.isActive ? "ring-2 ring-[#173f35]" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-bold text-[#173f35]">{item.label}</span>
                      {item.isActive && <span className="shrink-0 rounded-full bg-[#dcece3] px-2 py-0.5 text-[11px] font-semibold text-[#173f35]">启用中</span>}
                    </div>
                    <p className="mt-1 truncate text-xs text-[#66756d]">{providerDefaults[item.provider].title} · {item.chatModel} · {item.keyMask}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {!item.isActive && <button type="button" disabled={busy} onClick={() => void activate(item.id)} className="flex-1 rounded-xl bg-[#173f35] py-2 text-sm font-semibold text-white disabled:opacity-50">启用</button>}
                  <button type="button" disabled={busy} onClick={() => void remove(item.id, item.label)} className={`${item.isActive ? "flex-1" : ""} rounded-xl bg-rose-50 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50`}>删除</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {notice && <p role="status" className="fixed inset-x-5 top-[max(1rem,env(safe-area-inset-top))] z-40 mx-auto max-w-md rounded-full bg-white/95 px-4 py-2 text-center text-sm font-medium text-[#405148] shadow-lg backdrop-blur-xl">{notice}</p>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-[#53635b]">{label}<span className="[&_input]:w-full [&_input]:rounded-xl [&_input]:border-0 [&_input]:bg-[#f0f2ed] [&_input]:px-3 [&_input]:py-3">{children}</span></label>;
}
