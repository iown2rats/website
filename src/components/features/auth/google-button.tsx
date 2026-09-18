import Link from "next/link";
import { cn } from "@/lib/cn";
import { signInRoute } from "@/server/auth/route-access";

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

/** Telegram's paper-plane mark on its blue disc (brand colour #2AABEE), same footprint as the Google mark. */
export function TelegramMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#2AABEE" />
      <path
        fill="#fff"
        d="M10.9 23.4c7-3.1 11.7-5.1 14.1-6.1 6.7-2.8 8.1-3.3 9-3.3.2 0 .7 0 1 .3.3.2.3.5.4.8v1c-.4 3.8-1.9 13-2.7 17.3-.3 1.8-1 2.4-1.7 2.5-1.4.1-2.5-.9-3.9-1.8-2.1-1.4-3.4-2.3-5.4-3.6-2.4-1.6-.8-2.4.5-3.8.4-.4 6.4-5.9 6.5-6.4v-.3c-.1-.1-.2-.1-.3-.1-.2 0-2.9 1.8-8.3 5.4-.8.5-1.5.8-2.2.8-.7 0-2.1-.4-3.1-.7-1.3-.4-2.3-.6-2.2-1.3 0-.4.5-.7 1.5-1.1z"
      />
    </svg>
  );
}

export type SignInButtonProvider = "google" | "telegram";

const MARKS: Record<SignInButtonProvider, () => React.JSX.Element> = { google: () => <GoogleMark />, telegram: () => <TelegramMark /> };
const LABELS: Record<SignInButtonProvider, string> = { google: "Continue with Google", telegram: "Continue with Telegram" };

/**
 * "Continue with <provider>": a plain link to that provider's start endpoint (no JS needed). Both providers share
 * the white sign-in surface with the provider's own mark, so the two buttons read as one choice.
 */
export function ContinueWith({ provider, className, label, purpose = "login", returnTo }: { provider: SignInButtonProvider; className?: string; label?: string; purpose?: "login" | "reauth"; returnTo?: string }) {
  const start = signInRoute(provider);
  const href = purpose === "reauth" ? `${start}?purpose=reauth${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}` : start;
  const Mark = MARKS[provider];
  return (
    <Link href={href} prefetch={false} className={cn("flex h-13 items-center justify-center gap-3 rounded-lg bg-white text-cta-lg text-[#1f1f1f] shadow-sm pressable", className)}>
      <Mark />
      {label ?? LABELS[provider]}
    </Link>
  );
}

export function ContinueWithGoogle(props: Omit<Parameters<typeof ContinueWith>[0], "provider">) {
  return <ContinueWith provider="google" {...props} />;
}

export function ContinueWithTelegram(props: Omit<Parameters<typeof ContinueWith>[0], "provider">) {
  return <ContinueWith provider="telegram" {...props} />;
}
