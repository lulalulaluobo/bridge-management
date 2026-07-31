import { NextResponse } from "next/server";

import { getAuthStore } from "@/lib/auth";
import { sessionId } from "@/lib/household";
import { isSecureRequest } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  getAuthStore().logout(await sessionId());
  const response = NextResponse.json({ ok: true });
  response.cookies.set("fridge_session", "", { httpOnly: true, sameSite: "lax", secure: isSecureRequest(request), path: "/", maxAge: 0 });
  return response;
}
