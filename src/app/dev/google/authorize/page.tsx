import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { safeInternalPath } from "@/server/auth/route-access";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT ONLY — stand-in for Google's consent screen when AUTH_PROVIDER=dev (docs/ARCHITECTURE.md §4.1).
 * Lists the seeded development identities (each mapped to a demo account by the seed, never by name matching)
 * and lets a developer type any other email to create a new account. Issues a signed code bound to the state,
 * nonce, PKCE challenge and redirect URI, exactly like the real provider. 404 in production (and the env refuses
 * AUTH_PROVIDER=dev there).
 */
export default async function DevGoogleAuthorize({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const env = getEnv();
  if (env.AUTH_PROVIDER !== "dev") notFound();
  const sp = await searchParams;
  const redirect = sp.redirect_uri ?? "";
  const state = sp.state ?? "";
  const nonce = sp.nonce ?? "";
  const challenge = sp.code_challenge ?? "";
  const hint = sp.login_hint ?? "";
  const identities = await getDb().authIdentity.findMany({
    where: { provider: "GOOGLE" },
    orderBy: [{ createdAt: "asc" }],
    select: { providerSubject: true, email: true, displayName: true, releasedAt: true, user: { select: { status: true, profile: { select: { displayName: true } } } } },
  });
  const hidden = (
    <>
      <input type="hidden" name="redirect_uri" value={redirect} />
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="nonce" value={nonce} />
      <input type="hidden" name="code_challenge" value={challenge} />
    </>
  );
  const cancelHref = `${safeInternalPath(new URL(redirect || "http://x/", "http://x").pathname, "/auth/google/callback")}?error=access_denied&state=${encodeURIComponent(state)}`;
  return (
    <main className="min-h-dvh bg-[#f8f9fa] px-4 py-8 text-[#1f1f1f]">
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5 rounded-2xl border border-[#dadce0] bg-white p-7 shadow-sm">
        <div className="flex flex-col gap-1">
          <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">Development identity provider</span>
          <h1 className="text-[22px] font-semibold">Choose an account</h1>
          <p className="text-[14px] text-[#5f6368]">to continue to <span className="font-semibold text-[#1f1f1f]">Thundi (local)</span>. This screen stands in for Google and does not exist in production.</p>
        </div>
        <ul className="m-0 flex list-none flex-col divide-y divide-[#e8eaed] overflow-hidden rounded-xl border border-[#dadce0] p-0">
          {identities.map((i) => {
            const deleted = i.user.status === "DELETED" || i.releasedAt !== null;
            const name = i.displayName ?? i.user.profile?.displayName ?? i.providerSubject;
            return (
              <li key={i.providerSubject}>
                <form method="post" action="/dev/google/issue" className="m-0">
                  {hidden}
                  <input type="hidden" name="sub" value={i.providerSubject} />
                  <input type="hidden" name="email" value={i.email || `${i.providerSubject}@deleted.thundi.dev`} />
                  <input type="hidden" name="name" value={name} />
                  <button type="submit" className={`flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left hover:bg-[#f1f3f4] ${hint && hint === i.email ? "bg-[#e8f0fe]" : ""}`}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#1a73e8] text-[14px] font-bold text-white">{(name[0] ?? "?").toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{name}{deleted ? " · previous account deleted" : ""}</span>
                      <span className="block truncate text-[13px] text-[#5f6368]">{i.email || "email scrubbed on deletion"} · {i.user.status.toLowerCase()}</span>
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
          <label className="flex flex-col gap-1 text-[12px] text-[#5f6368]">Email<input name="email" type="email" required placeholder="someone@example.com" className="h-10 rounded-lg border border-[#dadce0] px-3 text-[14px] text-[#1f1f1f]" /></label>
          <label className="flex flex-col gap-1 text-[12px] text-[#5f6368]">Name<input name="name" type="text" placeholder="Display name" className="h-10 rounded-lg border border-[#dadce0] px-3 text-[14px] text-[#1f1f1f]" /></label>
          <button type="submit" className="h-10 rounded-lg border-0 bg-[#1a73e8] text-[14px] font-semibold text-white">Continue</button>
          <p className="m-0 text-[11px] text-[#5f6368]">The subject is derived from the email so the same email always maps to the same account.</p>
        </form>
        <a href={cancelHref} className="text-center text-[13px] font-semibold text-[#1a73e8]">Cancel</a>
      </div>
    </main>
  );
}
