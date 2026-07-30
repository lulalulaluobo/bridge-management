import { NextResponse } from "next/server";

import { currentHouseholdId } from "@/lib/household";
import { getInventoryStore } from "@/lib/inventory/store";

export const runtime = "nodejs";

export async function GET() { return NextResponse.json({ history: getInventoryStore(await currentHouseholdId()).listOperationHistory() }); }
