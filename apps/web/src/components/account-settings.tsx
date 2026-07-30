"use client";

import { useState } from "react";

export function AccountSettings({ username }: { username: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, nextPassword }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "无法修改密码");
      setCurrentPassword(""); setNextPassword(""); setNotice("密码已更新");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "无法修改密码"); } finally { setBusy(false); }
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }
  return <section className="rounded-[26px] border border-white/80 bg-white p-5 shadow-[0_3px_14px_rgba(23,63,53,.05)]"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold tracking-[-.03em]">家庭账号</h2><p className="mt-1 text-sm text-[#65746c]">当前登录：{username}</p></div><button type="button" onClick={() => void logout()} className="rounded-full bg-[#f1f3ef] px-3 py-2 text-sm font-semibold text-[#52625a]">退出</button></div><form onSubmit={changePassword} className="mt-5 grid gap-3"><input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前密码" className="rounded-2xl bg-[#f0f2ed] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#173f35]" /><input required minLength={6} type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="新密码（至少 6 位）" className="rounded-2xl bg-[#f0f2ed] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#173f35]" /><button disabled={busy} className="rounded-2xl bg-[#173f35] py-3 font-semibold text-white disabled:opacity-60">{busy ? "正在保存…" : "修改密码"}</button>{notice && <p className="text-sm text-[#52625a]">{notice}</p>}</form></section>;
}
