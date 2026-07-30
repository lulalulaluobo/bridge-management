import { NextResponse } from "next/server";

import { respondToUser } from "@/lib/agent/decision";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await respondToUser(await request.json()));
  } catch (error) {
    return errorResponse(error, "Agent 暂时无法回复");
  }
}
