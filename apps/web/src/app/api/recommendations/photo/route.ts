import { NextResponse } from "next/server";
import { z } from "zod";

import { currentHouseholdId } from "@/lib/household";
import { errorResponse } from "@/lib/http";
import { foodCategories, storageLocations } from "@/lib/inventory/types";
import { getPreferenceStore } from "@/lib/preferences";
import { recommendMeals } from "@/lib/recipes";

export const runtime = "nodejs";

const bodySchema = z.object({
  candidates: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    category: z.enum(foodCategories),
    quantity: z.number().positive(),
    unit: z.string().trim().min(1).max(16),
    storageLocation: z.enum(storageLocations),
    opened: z.boolean(),
  })).min(1).max(30),
});

export async function POST(request: Request) {
  try {
    const householdId = await currentHouseholdId();
    const { candidates } = bodySchema.parse(await request.json());
    return NextResponse.json({ recommendations: await recommendMeals(getPreferenceStore(householdId).get(), householdId, candidates) });
  } catch (error) {
    return errorResponse(error, "无法根据照片食材推荐菜式");
  }
}
