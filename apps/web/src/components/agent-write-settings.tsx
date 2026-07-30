"use client";

import { useEffect, useState } from "react";

export function AgentWriteSettings() {
  const [enabled, setEnabled] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { void fetch("/api/settings/agent").then(async (response) => {
    const data = await response.json() as { settings?: { naturalLanguageAutoSave?: boolean } };
    if (response.ok) setEnabled(Boolean(data.settings?.naturalLanguageAutoSave));
  }).catch(() => setNotice("写入设置暂时无法读取")); }, []);

  async function update(next: boolean) {
    setNotice("");
    const response = await fetch("/api/settings/agent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ naturalLanguageAutoSave: next }) });
    if (!response.ok) { setNotice("无法保存写入设置"); return; }
    setEnabled(next);
    setNotice(next ? "已开启自然语言自动入库" : "已关闭自动入库，之后会再次确认");
  }

  return <section className="rounded-3xl bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">自然语言自动入库</h2><p className="mt-1 text-sm leading-6 text-slate-600">开启后，说“买了牛奶”会按默认位置和有效期直接写入；关闭时仍显示二次确认。</p></div><button type="button" role="switch" aria-checked={enabled} onClick={() => void update(!enabled)} className={`relative mt-1 h-8 w-14 rounded-full transition-colors ${enabled ? "bg-[#173f35]" : "bg-slate-300"}`} aria-label="切换自然语言自动入库"><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-7" : "translate-x-1"}`} /></button></div>{notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}</section>;
}
