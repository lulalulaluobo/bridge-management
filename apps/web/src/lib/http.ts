import { NextResponse } from "next/server";

export function errorResponse(error: unknown, fallback = "请求失败") {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}
