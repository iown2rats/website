import type { NextRequest } from "next/server";
import { completeSignIn } from "@/server/auth/flow";

/**
 * GET /auth/telegram/callback — the redirect URI registered in BotFather (exactly
 * https://www.mellocrush.com/auth/telegram/callback in production). Completes the Telegram flow: state and
 * provider check against the pending-auth cookie, code exchange with PKCE and the server-side client secret,
 * RS256 ID-token verification against Telegram's JWKS, then the shared identity mapping.
 */
export async function GET(request: NextRequest) {
  return completeSignIn(request, "telegram");
}
