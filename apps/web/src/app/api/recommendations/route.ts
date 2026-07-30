import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getPreferenceStore } from "@/lib/preferences";
import { recommendMeals } from "@/lib/recipes";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";
export async function POST() {
  try { const householdId = await currentHouseholdId(); return NextResponse.json({ recommendations: await recommendMeals(getPreferenceStore(householdId).get(), householdId) }); } catch (error) { return errorResponse(error, "无法生成菜式推荐"); }
}
