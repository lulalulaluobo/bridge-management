import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getPreferenceStore } from "@/lib/preferences";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ preferences: getPreferenceStore().get() }); }
export async function PUT(request: Request) {
  try { return NextResponse.json({ preferences: getPreferenceStore().save(await request.json()) }); } catch (error) { return errorResponse(error, "无法保存饮食偏好"); }
}
