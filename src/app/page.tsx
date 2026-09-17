import { redirect } from "next/navigation";
import { ContinueWithGoogle } from "@/components/features/auth/google-button";
import { ThundiLogo } from "@/components/ui/icons";
import { getAuthState } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";

/**
 * Welcome screen (prototype onboarding step 0): full-bleed lagoon gradient, wordmark, hero copy and one CTA.
 * Sign-in and sign-up are the same action — Continue with Google (docs/ARCHITECTURE.md §4.1) — so the
 * prototype's "Get started" / "I already have an account" pair collapses into it. Signed-in users move on.
 */
export default async function WelcomePage() {
  const state = await getAuthState();
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);

  return (
    <main
      className="fixed inset-0 flex flex-col overflow-hidden text-white"
      style={{ background: "linear-gradient(180deg, hsl(186 60% 78%) 0%, hsl(190 62% 52%) 45%, #063B4C 100%)" }}
    >
      <div aria-hidden="true" className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 40% at 50% 38%, rgba(255,255,255,.35), transparent 70%)" }} />
      <div aria-hidden="true" className="absolute inset-x-0 top-[62%] h-[38%]" style={{ background: "linear-gradient(180deg, rgba(6,59,76,0), #063B4C 60%)" }} />
      <div
        className="relative z-[1] mt-auto flex w-full max-w-[var(--onboarding-max)] flex-col gap-3.5 self-center px-5"
        style={{ paddingBottom: "calc(20px + var(--safe-bottom))" }}
      >
        <div className="flex items-center gap-2 text-h3">
          <ThundiLogo size={26} color="#fff" />
          thundi
        </div>
        <h1 className="text-hero">Meet someone closer to home.</h1>
        <p className="text-body-lg text-white/80">Dating for the Maldives. Private by design, 18+ only.</p>
        <ContinueWithGoogle className="mt-2" />
        <p className="text-caption leading-relaxed text-white/70">
          New or returning, this is the only way in. Google confirms your Google account; your Thundi profile and verification are separate. Your email is never shown to other members.
        </p>
      </div>
    </main>
  );
}
