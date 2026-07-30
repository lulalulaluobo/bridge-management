import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { recognizeFoodImage } from "@/lib/media/recognition";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const file = (await request.formData()).get("image");
    if (!(file instanceof File)) throw new Error("请选择图片");
    return NextResponse.json({ candidates: await recognizeFoodImage(file, await currentHouseholdId()) });
  } catch (error) {
    return errorResponse(error, "图片识别失败");
  }
}
