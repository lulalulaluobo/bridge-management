import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getPreferenceStore } from "@/lib/preferences";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ preferences: getPreferenceStore(await currentHouseholdId()).get() }); }
export async function PUT(request: Request) {
  try { return NextResponse.json({ preferences: getPreferenceStore(await currentHouseholdId()).save(await request.json()) }); } catch (error) { return errorResponse(error, "无法保存饮食偏好"); }
}
