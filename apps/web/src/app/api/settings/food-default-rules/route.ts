import { NextResponse } from "next/server";
import { z } from "zod";

import { currentHouseholdId } from "@/lib/household";
import { errorResponse } from "@/lib/http";
import { getInventoryStore } from "@/lib/inventory/store";
import { storageLocations } from "@/lib/inventory/types";

const inputSchema = z.object({ name: z.string().trim().min(1).max(80), shelfLifeDays: z.number().int().min(0).max(3650), storageLocation: z.enum(storageLocations) });
const deleteSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET() { return NextResponse.json({ rules: getInventoryStore(await currentHouseholdId()).listFoodDefaultRules() }); }
export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    getInventoryStore(await currentHouseholdId()).setFoodDefaultRule(input.name, input.shelfLifeDays, input.storageLocation);
    return NextResponse.json({ rule: input }, { status: 201 });
  } catch (error) { return errorResponse(error, "无法保存食物默认规则"); }
}
export async function DELETE(request: Request) {
  try {
    const input = deleteSchema.parse(await request.json());
    getInventoryStore(await currentHouseholdId()).deleteFoodDefaultRule(input.name);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error, "无法删除食物默认规则"); }
}
