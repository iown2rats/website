import Link from "next/link";
import { ContinueWith } from "@/components/features/auth/google-button";
import { Wordmark } from "@/components/brand/logo";
import { isSignInProvider, PROVIDER_LABEL, type SignInProvider } from "@/server/auth/oidc";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Sign in" };

/** Copy per failure reason; `P` is the provider's name (Google or Telegram). */
const REASONS: Record<string, (P: string) => { title: string; body: string }> = {
  cancelled: (P) => ({ title: "Sign-in cancelled", body: `You closed the ${P} window before finishing. Nothing was changed.` }),
  state: () => ({ title: "That sign-in link expired", body: "Sign-in links only work for a few minutes and in the browser that started them. Start again." }),
  token: (P) => ({ title: `${P} didn't confirm that sign-in`, body: `We couldn't verify the response from ${P}. Start again — if it keeps happening, check the time on your device.` }),
  session: () => ({ title: "Your session changed", body: "The confirmation belongs to a different session. Open Settings again and retry." }),
  identity: (P) => ({ title: `That's a different ${P} account`, body: `To confirm this action, sign in with the same ${P} account you use for Mellocrush.` }),
  unavailable: () => ({ title: "This account isn't available", body: "This Mellocrush account has been suspended. Contact support if you think this is a mistake." }),
  provider: (P) => ({ title: `${P} returned an error`, body: `Something went wrong on ${P}'s side. Try again in a moment.` }),
};

/** Every sign-in failure lands here with a reason code and no account detail. */
export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string; provider?: string }> }) {
  const { reason, provider: rawProvider } = await searchParams;
  const provider: SignInProvider = isSignInProvider(rawProvider) ? rawProvider : "google";
  const r = (REASONS[reason ?? ""] ?? REASONS.provider!)(PROVIDER_LABEL[provider]);
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center bg-background px-5 text-text">
      <div className="flex w-full max-w-[var(--onboarding-max)] flex-col gap-4">
        <div className="flex items-center"><Wordmark height={24} /></div>
        <h1 className="text-h2">{r.title}</h1>
        <p className="text-body text-text-secondary">{r.body}</p>
        {reason !== "unavailable" ? <ContinueWith provider={provider} className="mt-2 shadow-sm" /> : null}
        <Link href={ROUTES.welcome} className="flex h-11 items-center justify-center text-body-sm font-medium text-text-secondary">Back to start</Link>
      </div>
    </main>
  );
}
