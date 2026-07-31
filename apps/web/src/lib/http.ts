import { NextResponse } from "next/server";

export function errorResponse(error: unknown, fallback = "请求失败") {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * 判断当前请求是否通过 HTTPS 到达,用于决定 cookie 是否标记 Secure。
 * Secure cookie 在 HTTP 下会被浏览器丢弃,因此必须按真实协议而非
 * NODE_ENV 判断,否则内网 HTTP 部署会登不上。
 * 反代(如 Nginx)需正确设置 X-Forwarded-Proto。
 */
export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}
