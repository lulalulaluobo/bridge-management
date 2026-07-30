"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const onBeforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstall); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  if (!prompt) return null;
  return <button type="button" onClick={() => { void prompt.prompt().then(async () => { await prompt.userChoice; setPrompt(null); }); }} className="fixed right-5 top-[max(1.2rem,env(safe-area-inset-top))] z-20 grid h-11 w-11 place-items-center rounded-full bg-[#dcece3] text-[#173f35] shadow-[0_2px_10px_rgba(23,63,53,.08)] active:scale-95" aria-label="安装冰箱 Agent 到桌面" title="安装到桌面"><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-[1.8]" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg></button>;
}
