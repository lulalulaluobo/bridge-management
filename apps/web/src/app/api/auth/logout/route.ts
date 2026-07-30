import { NextResponse } from "next/server";

import { getAuthStore } from "@/lib/auth";
import { sessionId } from "@/lib/household";

export const runtime = "nodejs";

export async function POST() {
  getAuthStore().logout(await sessionId());
  const response = NextResponse.json({ ok: true });
  response.cookies.set("fridge_session", "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
