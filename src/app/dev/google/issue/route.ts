import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { DevOidcProvider, getOidcProvider, redirectUri } from "@/server/auth/oidc";

/**
 * DEVELOPMENT ONLY — the dev identity provider's "authorization response". Issues a signed code for the chosen
 * identity, bound to the redirect URI, nonce and PKCE challenge, and redirects back to the app's callback.
 */
export async function POST(request: NextRequest) {
  if (getEnv().AUTH_PROVIDER !== "dev") return new NextResponse("Not found", { status: 404 });
  const provider = getOidcProvider();
  if (!(provider instanceof DevOidcProvider)) return new NextResponse("Not found", { status: 404 });
  const form = await request.formData();
  const redirect = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const nonce = String(form.get("nonce") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim() || null;
  const sub = String(form.get("sub") ?? "").trim() || `dev-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
  if (redirect !== redirectUri() || !state || !nonce || !codeChallenge || !email.includes("@")) return new NextResponse("Bad request", { status: 400 });
  const code = provider.issueCode({ sub, email, name }, { redirectUri: redirect, nonce, codeChallenge });
  const url = new URL(redirect);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url, { status: 303 });
}
