import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "冰箱 Agent",
    short_name: "冰箱 Agent",
    description: "用对话管理家庭冰箱库存。",
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    background_color: "#f7f7f2",
    theme_color: "#173f35",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
