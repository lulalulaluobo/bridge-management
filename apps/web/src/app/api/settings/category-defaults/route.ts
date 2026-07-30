import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/http";
import { currentHouseholdId } from "@/lib/household";
import { getInventoryStore } from "@/lib/inventory/store";
import { foodCategories, storageLocations } from "@/lib/inventory/types";

const inputSchema = z.object({
  category: z.enum(foodCategories),
  shelfLifeDays: z.number().int().min(0).max(3650),
  storageLocation: z.enum(storageLocations),
});

export async function GET() {
  return NextResponse.json({ defaults: getInventoryStore(await currentHouseholdId()).listCategoryDefaults() });
}

export async function PUT(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    getInventoryStore(await currentHouseholdId()).setCategoryDefault(input.category, input.shelfLifeDays, input.storageLocation);
    return NextResponse.json({ default: input });
  } catch (error) {
    return errorResponse(error, "无法保存默认有效期");
  }
}
