import Link from "next/link";
import { ContinueWithGoogle } from "@/components/features/auth/google-button";
import { ThundiLogo } from "@/components/ui/icons";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Sign in" };

const REASONS: Record<string, { title: string; body: string }> = {
  cancelled: { title: "Sign-in cancelled", body: "You closed the Google window before finishing. Nothing was changed." },
  state: { title: "That sign-in link expired", body: "Sign-in links only work for a few minutes and in the browser that started them. Start again." },
  token: { title: "Google didn't confirm that sign-in", body: "We couldn't verify the response from Google. Start again — if it keeps happening, check the time on your device." },
  session: { title: "Your session changed", body: "The confirmation belongs to a different session. Open Settings again and retry." },
  identity: { title: "That's a different Google account", body: "To confirm this action, sign in with the same Google account you use for Thundi." },
  unavailable: { title: "This account isn't available", body: "This Thundi account has been suspended. Contact support if you think this is a mistake." },
  provider: { title: "Google returned an error", body: "Something went wrong on Google's side. Try again in a moment." },
};

/** Every sign-in failure lands here with a reason code and no account detail. */
export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const r = REASONS[reason ?? ""] ?? REASONS.provider!;
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center bg-background px-5 text-text">
      <div className="flex w-full max-w-[var(--onboarding-max)] flex-col gap-4">
        <div className="flex items-center gap-2 text-h3"><ThundiLogo size={24} /> thundi</div>
        <h1 className="text-h2">{r.title}</h1>
        <p className="text-body text-text-secondary">{r.body}</p>
        {reason !== "unavailable" ? <ContinueWithGoogle className="mt-2 border border-border" /> : null}
        <Link href={ROUTES.welcome} className="flex h-11 items-center justify-center text-body-sm font-semibold text-text-secondary">Back to start</Link>
      </div>
    </main>
  );
}
