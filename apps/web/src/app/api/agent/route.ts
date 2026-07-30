import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getConversationStore } from "@/lib/agent/conversation";
import { respondToUser } from "@/lib/agent/decision";
import { errorResponse } from "@/lib/http";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { message?: unknown; conversationId?: unknown; idempotencyKey?: unknown };
    if (typeof body.message !== "string" || !body.message.trim()) throw new Error("请输入内容");
    const conversationId = typeof body.conversationId === "string" && body.conversationId.length <= 100 ? body.conversationId : randomUUID();
    const householdId = await currentHouseholdId();
    const conversations = getConversationStore(householdId);
    conversations.append(conversationId, "user", body.message.trim());
    if (isConversationSummaryQuestion(body.message)) {
      const summary = conversations.summary(conversationId);
      const turns = Math.max(0, summary.userTurns - 1);
      const reply = `这次聊了 ${turns} 轮。最后成功入库：${summary.names.length ? summary.names.join("、") : "还没有成功写入食材"}。`;
      conversations.append(conversationId, "assistant", reply, "committed");
      return NextResponse.json({ message: reply, speech: reply, mode: "reply", proposal: null, committed: null, conversationId, history: conversations.history(conversationId) });
    }
    const context = conversations.history(conversationId).map((message) => ({ role: message.role, content: message.content, status: message.status }));
    const response = await respondToUser({ message: body.message, context, idempotencyKey: body.idempotencyKey }, householdId);
    conversations.append(conversationId, "assistant", response.message);
    if (response.committed) conversations.markPendingCommitted(conversationId, response.committed.proposalId, response.committed.action);
    return NextResponse.json({ ...response, conversationId, history: conversations.history(conversationId) });
  } catch (error) {
    return errorResponse(error, "Agent 暂时无法回复");
  }
}

function isConversationSummaryQuestion(message: string) {
  return /(这次.*聊了.*轮|最后.*入库|本次.*入库)/u.test(message.replace(/\s+/g, ""));
}
