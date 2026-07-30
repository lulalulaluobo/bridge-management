import type { Metadata } from "next";

import { PwaUpdate } from "@/components/pwa-update";
import { PwaInstall } from "@/components/pwa-install";
import "./globals.css";

export const metadata: Metadata = {
  title: "冰箱 Agent",
  description: "用对话管理家庭冰箱库存。",
  referrer: "no-referrer",
  applicationName: "冰箱 Agent",
  icons: { icon: "/icons/icon-512.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "冰箱 Agent" },
  formatDetection: { telephone: false },
};

export const viewport = { themeColor: "#173f35", width: "device-width", initialScale: 1, maximumScale: 1, minimumScale: 1, userScalable: false, viewportFit: "cover" } as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className="h-full antialiased"><body className="min-h-full"><PwaUpdate /><PwaInstall />{children}</body></html>;
}
