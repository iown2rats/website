import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isSignInProvider, PROVIDER_ENUM, PROVIDER_LABEL, type SignInProvider } from "@/server/auth/oidc";
import { safeInternalPath } from "@/server/auth/route-access";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT ONLY — stand-in for Google's consent screen, or Telegram's when `?provider=telegram`, when
 * AUTH_PROVIDER=dev (docs/ARCHITECTURE.md §4.1). Lists the existing development identities of that provider (each
 * mapped to an account by the seed or an earlier sign-in, never by name matching) and lets a developer type another
 * one to create a new account: an email for the Google shape, a Telegram username for the Telegram shape (which has
 * no email, like the real thing). Issues a signed code bound to the state, nonce, PKCE challenge and redirect URI,
 * exactly like the real provider. 404 in production (and the env refuses AUTH_PROVIDER=dev there).
 */
export default async function DevGoogleAuthorize({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const env = getEnv();
  if (env.AUTH_PROVIDER !== "dev") notFound();
  const sp = await searchParams;
  const provider: SignInProvider = isSignInProvider(sp.provider) ? sp.provider : "google";
  const telegram = provider === "telegram";
  const label = PROVIDER_LABEL[provider];
  const redirect = sp.redirect_uri ?? "";
  const state = sp.state ?? "";
  const nonce = sp.nonce ?? "";
  const challenge = sp.code_challenge ?? "";
  const hint = sp.login_hint ?? "";
  const identities = await getDb().authIdentity.findMany({
    where: { provider: PROVIDER_ENUM[provider] },
    orderBy: [{ createdAt: "asc" }],
    select: { providerSubject: true, email: true, displayName: true, providerUsername: true, releasedAt: true, user: { select: { status: true, profile: { select: { displayName: true } } } } },
  });
  const hidden = (
    <>
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="redirect_uri" value={redirect} />
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="nonce" value={nonce} />
      <input type="hidden" name="code_challenge" value={challenge} />
    </>
  );
  const cancelHref = `${safeInternalPath(new URL(redirect || "http://x/", "http://x").pathname, `/auth/${provider}/callback`)}?error=access_denied&state=${encodeURIComponent(state)}`;
  const accent = telegram ? "#2AABEE" : "#1a73e8";
  return (
    <main className="min-h-dvh bg-[#f8f9fa] px-4 py-8 text-[#1f1f1f]">
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5 rounded-2xl border border-[#dadce0] bg-white p-7 shadow-sm">
        <div className="flex flex-col gap-1">
          <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">Development identity provider</span>
          <h1 className="text-[22px] font-semibold">Choose an account</h1>
          <p className="text-[14px] text-[#5f6368]">to continue to <span className="font-semibold text-[#1f1f1f]">Mellocrush (local)</span>. This screen stands in for {label} and does not exist in production.</p>
        </div>
        <ul className="m-0 flex list-none flex-col divide-y divide-[#e8eaed] overflow-hidden rounded-xl border border-[#dadce0] p-0">
          {identities.map((i) => {
            const deleted = i.user.status === "DELETED" || i.releasedAt !== null;
            const name = i.displayName ?? i.user.profile?.displayName ?? i.providerSubject;
            const secondary = telegram ? (i.providerUsername ? `@${i.providerUsername}` : deleted ? "username scrubbed on deletion" : "no username") : i.email || "email scrubbed on deletion";
            return (
              <li key={i.providerSubject}>
                <form method="post" action="/dev/google/issue" className="m-0">
                  {hidden}
                  <input type="hidden" name="sub" value={i.providerSubject} />
                  {telegram ? <input type="hidden" name="username" value={i.providerUsername ?? ""} /> : <input type="hidden" name="email" value={i.email || `${i.providerSubject}@deleted.thundi.dev`} />}
                  <input type="hidden" name="name" value={name} />
                  <button type="submit" className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left hover:bg-[#f1f3f4] ${hint && hint === i.email ? "bg-[#e8f0fe]" : ""}`}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-bold text-white" style={{ background: accent }}>{(name[0] ?? "?").toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{name}{deleted ? " · previous account deleted" : ""}</span>
                      <span className="block truncate text-[13px] text-[#5f6368]">{secondary} · {i.user.status.toLowerCase()}</span>
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
        <form method="post" action="/dev/google/issue" className="m-0 flex flex-col gap-2.5 rounded-xl border border-dashed border-[#dadce0] p-4">
          {hidden}
          <p className="m-0 text-[13px] font-semibold">Use another account</p>
          {telegram ? (
            <label className="flex flex-col gap-1 text-[12px] text-[#5f6368]">Telegram username<input name="username" type="text" required pattern="@?[A-Za-z0-9_]{1,64}" placeholder="someone" className="h-10 rounded-lg border border-[#dadce0] px-3 text-[14px] text-[#1f1f1f]" /></label>
          ) : (
            <label className="flex flex-col gap-1 text-[12px] text-[#5f6368]">Email<input name="email" type="email" required placeholder="someone@example.com" className="h-10 rounded-lg border border-[#dadce0] px-3 text-[14px] text-[#1f1f1f]" /></label>
          )}
          <label className="flex flex-col gap-1 text-[12px] text-[#5f6368]">Name<input name="name" type="text" placeholder="Display name" className="h-10 rounded-lg border border-[#dadce0] px-3 text-[14px] text-[#1f1f1f]" /></label>
          <button type="submit" className="h-10 rounded-lg border-0 text-[14px] font-semibold text-white" style={{ background: accent }}>Continue</button>
          <p className="m-0 text-[11px] text-[#5f6368]">{telegram ? "The subject is derived from the username so the same username always maps to the same account. No email is issued, like real Telegram." : "The subject is derived from the email so the same email always maps to the same account."}</p>
        </form>
        <a href={cancelHref} className="text-center text-[13px] font-semibold" style={{ color: accent }}>Cancel</a>
      </div>
    </main>
  );
}
