"use client";

import { useState } from "react";

export function AccountGate() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "无法登录");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法登录"); } finally { setBusy(false); }
  }

  return <main className="grid min-h-[100dvh] place-items-center bg-[#f3f4f0] px-6 text-[#17231f]"><form onSubmit={submit} className="w-full max-w-sm rounded-[30px] border border-white/80 bg-white/85 p-6 shadow-[0_20px_50px_rgba(23,63,53,.12)] backdrop-blur-xl"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#dcece3] text-2xl">❄</div><h1 className="mt-5 text-[28px] font-bold tracking-[-.04em]">冰箱小精灵</h1><p className="mt-2 text-sm leading-6 text-[#64736c]">登录同一账号，就能在家人的不同设备上看到同一份库存。</p><label className="mt-6 grid gap-2 text-sm font-semibold">账号<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="rounded-2xl bg-[#f0f2ed] px-4 py-3 font-normal outline-none focus:ring-2 focus:ring-[#173f35]" /></label><label className="mt-4 grid gap-2 text-sm font-semibold">密码<input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-2xl bg-[#f0f2ed] px-4 py-3 font-normal outline-none focus:ring-2 focus:ring-[#173f35]" /></label>{error && <p className="mt-3 text-sm text-rose-700">{error}</p>}<button disabled={busy} className="mt-6 w-full rounded-2xl bg-[#173f35] py-3.5 font-semibold text-white disabled:opacity-60">{busy ? "正在登录…" : "登录"}</button><p className="mt-4 text-center text-xs text-[#7a8881]">初始账号：admin　初始密码：admin123</p></form></main>;
}
