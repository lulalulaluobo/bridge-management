import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { currentHouseholdId } from "@/lib/household";
import { getInventoryStore } from "@/lib/inventory/store";
import { proposalActionSchema } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ batches: getInventoryStore(await currentHouseholdId()).listBatches() });
}

export async function POST(request: Request) {
  try {
    const householdId = await currentHouseholdId();
    const store = getInventoryStore(householdId);
    const body = await request.json();
    const action = proposalActionSchema.parse(body);
    const idempotencyKey = globalThis.crypto?.randomUUID?.() ?? `manual-${Date.now()}-${Math.random()}`;
    store.autoConfirm(action, idempotencyKey, "manual");
    return NextResponse.json({ batches: store.listBatches() }, { status: 200 });
  } catch (error) {
    return errorResponse(error, "更新库存失败");
  }
}
