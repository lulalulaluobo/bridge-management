import { NextResponse } from "next/server";
import { z } from "zod";

import { getAgentSettingsStore } from "@/lib/agent/settings";
import { currentHouseholdId } from "@/lib/household";
import { errorResponse } from "@/lib/http";

const inputSchema = z.object({ naturalLanguageAutoSave: z.boolean() });

export async function GET() { return NextResponse.json({ settings: getAgentSettingsStore(await currentHouseholdId()).get() }); }
export async function PUT(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    return NextResponse.json({ settings: getAgentSettingsStore(await currentHouseholdId()).save(input.naturalLanguageAutoSave) });
  } catch (error) { return errorResponse(error, "无法保存 Agent 写入设置"); }
}
