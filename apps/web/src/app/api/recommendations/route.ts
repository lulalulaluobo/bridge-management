import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/http";
import { getPreferenceStore } from "@/lib/preferences";
import { recommendMeals } from "@/lib/recipes";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

const bodySchema = z.object({
  mealTime: z.string().max(20).optional(),
  diners: z.string().max(20).optional(),
  extraConditions: z.string().max(200).optional(),
  // excludeDishes 必须是字符串数组,防止脏输入(如单个字符串)导致下游 .join() 崩溃;
  // 限长 50 避免被撑爆 prompt。每项 trim 去空、限 40 字。
  excludeDishes: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
});

export async function POST(request: Request) {
  try {
    const householdId = await currentHouseholdId();
    let raw: unknown = {};
    try {
      raw = await request.json();
    } catch {
      // Body may be empty
    }
    const body = bodySchema.parse(raw);

    const recommendations = await recommendMeals(
      getPreferenceStore(householdId).get(),
      householdId,
      [],
      {
        mealTime: body.mealTime,
        diners: body.diners,
        extraConditions: body.extraConditions,
        excludeDishes: body.excludeDishes,
      }
    );

    return NextResponse.json({ recommendations });
  } catch (error) {
    return errorResponse(error, "无法生成菜式推荐");
  }
}
