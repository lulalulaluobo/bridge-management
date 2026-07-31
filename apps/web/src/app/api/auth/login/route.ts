import { NextResponse } from "next/server";

import { getAuthStore } from "@/lib/auth";
import { anonymousHouseholdId } from "@/lib/household";
import { errorResponse, isSecureRequest } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string") throw new Error("请输入账号和密码");
    const login = getAuthStore().login(body.username, body.password, await anonymousHouseholdId());
    const response = NextResponse.json({ account: { username: login.account.username } });
    response.cookies.set("fridge_session", login.sessionId, { httpOnly: true, sameSite: "lax", secure: isSecureRequest(request), path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) { return errorResponse(error, "无法登录"); }
}
