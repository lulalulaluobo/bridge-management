import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getInventoryStore } from "@/lib/inventory/store";
import { currentHouseholdId } from "@/lib/household";
import { proposalActionSchema } from "@/lib/inventory/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const action = proposalActionSchema.parse(await request.json());
    return NextResponse.json({ proposal: getInventoryStore(await currentHouseholdId()).createProposal(action) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "无法创建待确认操作");
  }
}
