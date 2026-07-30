import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { getNotificationStore } from "@/lib/notifications";
export const runtime = "nodejs";
export async function POST(request: Request) { try { getNotificationStore().save(await request.json()); return new NextResponse(null, { status: 204 }); } catch (error) { return errorResponse(error, "无法启用提醒"); } }
export async function DELETE(request: Request) { try { const { endpoint } = await request.json() as { endpoint?: unknown }; if (typeof endpoint !== "string") throw new Error("无效的订阅"); getNotificationStore().remove(endpoint); return new NextResponse(null, { status: 204 }); } catch (error) { return errorResponse(error, "无法关闭提醒"); } }
