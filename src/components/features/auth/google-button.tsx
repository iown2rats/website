import Link from "next/link";
import { cn } from "@/lib/cn";
import { ROUTES } from "@/server/auth/route-access";

/** Google's "G" mark (brand guidelines: four-colour mark on white). */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.1-1.7 5.3-4.8 7.4l7.4 5.7c4.4-4.1 7.2-10.1 7.2-16.7z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.6 14.6 0 0 1 9.7 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** "Continue with Google" — the only way to sign in or sign up. A plain link to the start endpoint (no JS needed). */
export function ContinueWithGoogle({ className, label = "Continue with Google", purpose = "login", returnTo }: { className?: string; label?: string; purpose?: "login" | "reauth"; returnTo?: string }) {
  const href = purpose === "reauth" ? `${ROUTES.signIn}?purpose=reauth${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}` : ROUTES.signIn;
  return (
    <Link href={href} prefetch={false} className={cn("flex h-13 items-center justify-center gap-3 rounded-lg bg-white text-cta-lg text-[#1f1f1f] shadow-sm pressable", className)}>
      <GoogleMark />
      {label}
    </Link>
  );
}
