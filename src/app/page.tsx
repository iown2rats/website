import Link from "next/link";
import { ThundiLogo } from "@/components/ui/icons";

/**
 * Welcome screen (prototype onboarding step 0): full-bleed lagoon gradient, wordmark, hero copy,
 * white primary CTA and a ghost secondary. Authentication wiring arrives in Phase 5.
 */
export default function WelcomePage() {
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
        <Link
          href="/discover"
          className="mt-2 flex h-13 items-center justify-center rounded-lg bg-white text-cta-lg text-ocean pressable"
        >
          Get started
        </Link>
        <Link href="/discover" className="-mt-1.5 flex h-11 items-center justify-center text-body-sm font-semibold text-white/75">
          I already have an account
        </Link>
      </div>
    </main>
  );
}
