"use client";

import { useState } from "react";

export function NotificationControl({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function enable() {
    if (!vapidPublicKey) { setNotice("提醒服务尚未在部署环境配置，库存状态仍可在首页查看。"); return; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setNotice("当前浏览器不支持推送提醒，请继续查看首页临期状态。"); return; }
    setBusy(true); setNotice("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("你未授予通知权限；仍可在首页查看临期状态");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(vapidPublicKey) });
      const response = await fetch("/api/notifications/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription) });
      if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error ?? "无法保存提醒订阅"); }
      setNotice("已启用临期提醒。你随时可在浏览器设置中关闭它。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "无法启用提醒"); } finally { setBusy(false); }
  }

  return <section className="rounded-3xl bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">临期提醒</h2><p className="mt-1 text-sm text-slate-600">首页始终显示临期状态。开启后，服务端定时检查到临期或过期食材时会发送通知。</p><button type="button" disabled={busy} onClick={enable} className="mt-3 rounded-xl border border-[#173f35] px-4 py-3 text-sm font-semibold text-[#173f35] disabled:opacity-50">开启临期提醒</button>{notice && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm" role="status">{notice}</p>}</section>;
}

function base64UrlToUint8Array(value: string) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
