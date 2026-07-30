"use client";

import { useEffect, useState } from "react";

export function PwaUpdate() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    let registration: ServiceWorkerRegistration | undefined;
    const watch = (value: ServiceWorkerRegistration) => {
      registration = value;
      if (registration.waiting) setUpdateReady(true);
      registration.addEventListener("updatefound", () => {
        const installing = registration?.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
        });
      });
    };
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(watch).catch(() => undefined);
    return () => {
      if (registration) void registration.update().catch(() => undefined);
    };
  }, []);

  if (!updateReady) return null;
  return <button type="button" onClick={() => window.location.reload()} className="fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-50 rounded-2xl bg-[#173f35] px-4 py-3 text-left text-sm font-semibold text-white shadow-xl">有新版本可用，点此更新应用</button>;
}
