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

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as { provider?: unknown };
    if (body.provider !== "openai" && body.provider !== "deepseek" && body.provider !== "qwen") throw new Error("不支持的模型供应商");
    getCredentialStore(await currentHouseholdId()).delete(body.provider);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "无法删除模型 Key");
  }
}
