import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { sendExpiryReminders } from "@/lib/notifications";
export const runtime = "nodejs";
export async function POST(request: Request) { try { if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse(null, { status: 401 }); return NextResponse.json(await sendExpiryReminders()); } catch (error) { return errorResponse(error, "无法发送提醒"); } }
