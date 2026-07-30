import { NextResponse } from "next/server";

import { getAuthStore } from "@/lib/auth";
import { currentAccount } from "@/lib/household";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const account = await currentAccount();
    if (!account) throw new Error("请先登录");
    const body = await request.json() as { currentPassword?: unknown; nextPassword?: unknown };
    if (typeof body.currentPassword !== "string" || typeof body.nextPassword !== "string") throw new Error("请填写当前密码和新密码");
    getAuthStore().changePassword(account.username, body.currentPassword, body.nextPassword);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error, "无法修改密码"); }
}
