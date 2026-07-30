import { NextResponse } from "next/server";

import { getInventoryStore } from "@/lib/inventory/store";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ batches: getInventoryStore(await currentHouseholdId()).listBatches() });
}
