import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getPreferenceStore } from "@/lib/preferences";
import { recommendMeals } from "@/lib/recipes";

export const runtime = "nodejs";
export async function POST() {
  try { return NextResponse.json({ recommendations: await recommendMeals(getPreferenceStore().get()) }); } catch (error) { return errorResponse(error, "无法生成菜式推荐"); }
}
