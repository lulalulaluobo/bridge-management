import { NextResponse, type NextRequest } from "next/server";

import { isSecureRequest } from "@/lib/http";

const cookieName = "fridge_household";

export function proxy(request: NextRequest) {
  const householdId = request.cookies.get(cookieName)?.value ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-fridge-household-id", householdId);
  headers.set("x-fridge-session-id", request.cookies.get("fridge_session")?.value ?? "");
  const response = NextResponse.next({ request: { headers } });
  if (!request.cookies.get(cookieName)) response.cookies.set(cookieName, householdId, { httpOnly: true, sameSite: "lax", secure: isSecureRequest(request), path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|swe-worker).*)"] };
