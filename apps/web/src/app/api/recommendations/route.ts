import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getPreferenceStore } from "@/lib/preferences";
import { recommendMeals } from "@/lib/recipes";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const householdId = await currentHouseholdId();
    let body: { mealTime?: string; diners?: string; extraConditions?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // Body may be empty
    }

    const recommendations = await recommendMeals(
      getPreferenceStore(householdId).get(),
      householdId,
      [],
      {
        mealTime: body.mealTime,
        diners: body.diners,
        extraConditions: body.extraConditions,
      }
    );

    return NextResponse.json({ recommendations });
  } catch (error) {
    return errorResponse(error, "无法生成菜式推荐");
  }
}
