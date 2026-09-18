import type { NextRequest } from "next/server";
import { startSignIn } from "@/server/auth/flow";

/**
 * GET /auth/telegram/start — begins "Continue with Telegram" through Telegram's OpenID Connect service
 * (docs/ARCHITECTURE.md §4.1). 404 unless TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET are configured.
 */
export async function GET(request: NextRequest) {
  return startSignIn(request, "telegram");
}
