import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getCredentialStore } from "@/lib/llm/credentials";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ credentials: getCredentialStore(await currentHouseholdId()).list() });
}

export async function POST(request: Request) {
  try {
    const credential = await getCredentialStore(await currentHouseholdId()).verifyAndSave(await request.json());
    return NextResponse.json({ credential }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "无法保存模型 Key");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown; action?: unknown };
    if (body.action !== "activate" || typeof body.id !== "string") throw new Error("参数错误：需要 id 与 action=activate");
    const credential = getCredentialStore(await currentHouseholdId()).activate(body.id);
    return NextResponse.json({ credential });
  } catch (error) {
    return errorResponse(error, "无法切换启用项");
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("参数错误：需要 id");
    getCredentialStore(await currentHouseholdId()).delete(body.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "无法删除模型配置");
  }
}
