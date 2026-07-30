import { NextResponse } from "next/server";

import { getConversationStore } from "@/lib/agent/conversation";
import { errorResponse } from "@/lib/http";
import { getInventoryStore } from "@/lib/inventory/store";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/proposals/[proposalId]/confirm">) {
  try {
    const { proposalId } = await context.params;
    const body = (await request.json()) as { idempotencyKey?: unknown; conversationId?: unknown };
    if (typeof body.idempotencyKey !== "string") throw new Error("缺少幂等键");
    const householdId = await currentHouseholdId();
    const result = getInventoryStore(householdId).confirmProposal(proposalId, body.idempotencyKey, new Date(), "agent");
    if (typeof body.conversationId === "string" && body.conversationId) {
      const conversations = getConversationStore(householdId);
      conversations.markPendingCommitted(body.conversationId, result.proposalId, result.action);
      return NextResponse.json({ result, history: conversations.history(body.conversationId) });
    }
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error, "无法确认操作");
  }
}
