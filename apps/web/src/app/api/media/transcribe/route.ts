import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { transcribeAudio } from "@/lib/media/recognition";
import { currentHouseholdId } from "@/lib/household";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const file = (await request.formData()).get("audio");
    if (!(file instanceof File)) throw new Error("请选择录音");
    return NextResponse.json({ text: await transcribeAudio(file, await currentHouseholdId()) });
  } catch (error) {
    return errorResponse(error, "语音识别失败");
  }
}
