"use client";

import { useEffect, useState } from "react";

export function AgentWriteSettings() {
  const [enabled, setEnabled] = useState(true);
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
    setNotice(next ? "已开启语音自动入库" : "已关闭语音自动入库");
  }

  return <section className="rounded-3xl bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">语音自动入库</h2><p className="mt-1 text-sm leading-6 text-slate-600">说“买了牛奶”会按默认规则直接写入库存；关闭后只识别、不写入。</p></div><button type="button" role="switch" aria-checked={enabled} onClick={() => void update(!enabled)} className={`relative inline-flex h-10 w-[4.5rem] shrink-0 items-center rounded-full p-1 shadow-inner transition-colors ${enabled ? "bg-[#173f35]" : "bg-[#dfe5df]"}`} aria-label="切换语音自动入库"><span className={`grid h-8 w-8 place-items-center rounded-full bg-white text-xs font-bold shadow-[0_2px_6px_rgba(23,63,53,.18)] transition-transform ${enabled ? "translate-x-8 text-[#173f35]" : "translate-x-0 text-[#718078]"}`}>{enabled ? "开" : "关"}</span></button></div>{notice && <p className="mt-3 text-sm text-slate-600" role="status">{notice}</p>}</section>;
}
