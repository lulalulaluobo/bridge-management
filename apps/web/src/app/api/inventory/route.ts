import { NextResponse } from "next/server";

import { getInventoryStore } from "@/lib/inventory/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ batches: getInventoryStore().listBatches() });
}
