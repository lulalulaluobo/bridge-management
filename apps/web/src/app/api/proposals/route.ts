import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getInventoryStore } from "@/lib/inventory/store";
import { currentHouseholdId } from "@/lib/household";
import { proposalActionSchema } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; idempotencyKey?: unknown };
    const action = proposalActionSchema.parse(body.action ?? body);
    if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) throw new Error("缺少幂等键");
    return NextResponse.json({ result: getInventoryStore(await currentHouseholdId()).autoConfirm(action, body.idempotencyKey, "manual") }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "无法写入库存");
  }
}
