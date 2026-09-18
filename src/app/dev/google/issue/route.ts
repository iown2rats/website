import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { DevOidcProvider, getOidcProvider, isSignInProvider, redirectUri } from "@/server/auth/oidc";

/**
 * DEVELOPMENT ONLY — the dev identity provider's "authorization response" for either provider shape. Issues a
 * signed code for the chosen identity, bound to the redirect URI, nonce and PKCE challenge, and redirects back to
 * that provider's callback.
 */
export async function POST(request: NextRequest) {
  if (getEnv().AUTH_PROVIDER !== "dev") return new NextResponse("Not found", { status: 404 });
  const form = await request.formData();
  const kind = form.get("provider");
  const provider = getOidcProvider(isSignInProvider(kind) ? kind : "google");
  if (!(provider instanceof DevOidcProvider)) return new NextResponse("Not found", { status: 404 });
  const redirect = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const nonce = String(form.get("nonce") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const name = String(form.get("name") ?? "").trim() || null;
  if (redirect !== redirectUri(provider.kind) || !state || !nonce || !codeChallenge) return new NextResponse("Bad request", { status: 400 });

  let identity: { sub: string; email?: string; name: string | null; username?: string | null };
  if (provider.kind === "telegram") {
    const username = String(form.get("username") ?? "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,64}$/.test(username) && !form.get("sub")) return new NextResponse("Bad request", { status: 400 });
    // Real Telegram subjects are numeric user ids; the dev shape derives a stable numeric-looking id from the username.
    const sub = String(form.get("sub") ?? "").trim() || `9${BigInt(`0x${createHash("sha256").update(username.toLowerCase()).digest("hex").slice(0, 12)}`).toString().padStart(15, "0")}`;
    identity = { sub, name: name ?? (username || null), username: username || null };
  } else {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!email.includes("@")) return new NextResponse("Bad request", { status: 400 });
    const sub = String(form.get("sub") ?? "").trim() || `dev-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
    identity = { sub, email, name };
  }
  const code = provider.issueCode(identity, { redirectUri: redirect, nonce, codeChallenge });
  const url = new URL(redirect);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url, { status: 303 });
}
