"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { clearSessionCookie, readSessionToken } from "@/lib/session-cookie";
import { ROUTES } from "@/server/auth/route-access";
import { revokeSession } from "@/server/auth/session";

/*
 * Authentication is Google-only and runs through the /auth/google/start → callback route handlers
 * (docs/ARCHITECTURE.md §4.1). The only action here ends the current session.
 */
export async function logout(): Promise<void> {
  const token = await readSessionToken();
  if (token) await revokeSession(getDb(), token);
  await clearSessionCookie();
  redirect(ROUTES.welcome);
}
