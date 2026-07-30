import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getInventoryStore } from "@/lib/inventory/store";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/proposals/[proposalId]/confirm">) {
  try {
    const { proposalId } = await context.params;
    const body = (await request.json()) as { idempotencyKey?: unknown };
    if (typeof body.idempotencyKey !== "string") throw new Error("缺少幂等键");
    return NextResponse.json({ result: getInventoryStore(await currentHouseholdId()).confirmProposal(proposalId, body.idempotencyKey) });
  } catch (error) {
    return errorResponse(error, "无法确认操作");
  }
}
