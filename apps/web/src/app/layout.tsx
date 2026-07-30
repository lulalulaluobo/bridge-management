import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "冰箱 Agent",
  description: "用对话管理家庭冰箱库存。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className="h-full antialiased"><body className="min-h-full">{children}</body></html>;
}
