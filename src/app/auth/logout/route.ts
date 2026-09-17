import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { revokeSession } from "@/server/auth/session";

/** POST /auth/logout — revokes the current session and clears the cookie. Same-origin only. */
export async function POST(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(getDb(), token);
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: process.env.NODE_ENV === "production" });
  return response;
}
