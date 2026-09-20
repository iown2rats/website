import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { ROUTES } from "@/server/auth/route-access";

/*
 * The shell every signed-out auth screen shares (DESIGN_SYSTEM §26/§27): the night-beach photograph and one centred
 * frosted-glass card. The welcome screen, registration, "verify your email", "forgot password" and "reset password"
 * all render inside it, so the whole flow looks like one place.
 */
const HERO_WIDTHS = [480, 640, 828, 941] as const;
const HERO_SIZES = "100vw";
export const heroSrcSet = (ext: "avif" | "webp") => HERO_WIDTHS.map((w) => `/hero/night-beach-${w}.${ext} ${w}w`).join(", ");
export const HERO_PLACEHOLDER =
  "data:image/webp;base64,UklGRqoAAABXRUJQVlA4IJ4AAACQBgCdASoYACsAPu1apk2ppKMiMBqtUTAdiUAXwHfJI/FDxQnfRed3atLJdFMtX2F7/Au+3GFMTmUybP8AAP76ZF+QQChNPQ40reRPEAqP5n1yXBM7QfAPyXKqLBtoq9hpI3w4iDPyYGha0elpym/mpkJ6RxRGV+NGIKIGGcu1YhpzThEAlVht7CQRcxJXg2crX1fLBYHvAn4z+JAAAA==";

/** The photograph, untouched. The glass card carries its own contrast, so there are no scrims. */
export function AuthBackdrop({ priority = false }: { priority?: boolean }) {
  return (
    <>
      {priority ? <link rel="preload" as="image" type="image/avif" imageSrcSet={heroSrcSet("avif")} imageSizes={HERO_SIZES} fetchPriority="high" /> : null}
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-[50%_60%]" style={{ backgroundImage: `url("${HERO_PLACEHOLDER}")` }}>
        <picture>
          <source type="image/avif" srcSet={heroSrcSet("avif")} sizes={HERO_SIZES} />
          {/* A plain <img> inside <picture>: pre-rendered static files with an AVIF/WebP switch and a server-side
              preload; next/image would put an optimizer hop in front of the largest-contentful-paint element. */}
          <img
            src="/hero/night-beach-941.webp"
            srcSet={heroSrcSet("webp")}
            sizes={HERO_SIZES}
            width={941}
            height={1672}
            alt=""
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            className="h-full w-full object-cover object-[50%_50%] md:object-[50%_60%]"
          />
        </picture>
      </div>
    </>
  );
}

export interface AuthShellProps {
  children: ReactNode;
  /** Rendered under the card, outside the glass (a "back" link). */
  below?: ReactNode;
  /** The welcome screen preloads the photograph; the rest inherit it from the cache. */
  priority?: boolean;
  /** Heading id for the card's `aria-labelledby`. */
  labelledBy: string;
  className?: string;
}

export function AuthShell({ children, below, priority = false, labelledBy, className }: AuthShellProps) {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#050d14] text-white">
      <AuthBackdrop priority={priority} />
      <div
        className="relative z-[1] flex flex-1 flex-col items-center px-5 md:pt-[8vh]"
        style={{ paddingTop: "calc(6dvh + var(--safe-top))", paddingBottom: "calc(24px + var(--safe-bottom))" }}
      >
        <section
          aria-labelledby={labelledBy}
          className={cn(
            "flex w-full max-w-[380px] flex-col items-center rounded-[26px] border border-white/20 bg-white/12 px-3.5 pb-4 pt-5.5 text-center shadow-[0_24px_64px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 md:max-w-[400px] md:px-6",
            className,
          )}
        >
          {children}
        </section>
        {below ? <div className="mt-4 w-full max-w-[400px] text-center md:max-w-[420px]">{below}</div> : null}
      </div>
    </main>
  );
}

/** The white wordmark plus the tagline, at the top of every auth card. */
export function AuthHeading({ id, title, subtitle, compact = false }: { id: string; title?: string; subtitle?: string; compact?: boolean }) {
  return (
    <>
      <div className="flex justify-center">
        <Wordmark tone="white" height={compact ? 26 : 30} priority />
      </div>
      {title ? (
        <h1 id={id} className="mt-2.5 text-h4 font-medium leading-tight tracking-[-0.01em] text-white">
          {title}
        </h1>
      ) : (
        <h1 id={id} className="sr-only">
          Mellocrush
        </h1>
      )}
      {subtitle ? <p className="mt-1.5 text-body-sm leading-relaxed text-white/75">{subtitle}</p> : null}
    </>
  );
}

/** "Real people. Brighter days." — the welcome screen's tagline, in the supplied treatment. */
export function AuthTagline() {
  return <p className="mt-2 text-tiny font-medium uppercase tracking-[0.18em] text-white/70">Real people. Brighter days.</p>;
}

export function AuthLegalLine() {
  return (
    <p className="mt-3 text-tiny leading-relaxed text-white/75">
      By continuing, you agree to our
      <br />
      <Link href="/legal/terms" className="font-medium text-white underline decoration-white/70 underline-offset-[3px]">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link href="/legal/privacy" className="font-medium text-white underline decoration-white/70 underline-offset-[3px]">
        Privacy Policy
      </Link>
      .
    </p>
  );
}

export function AuthBackLink({ href = ROUTES.welcome, children = "Back to sign in" }: { href?: string; children?: ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-10 items-center justify-center text-body font-medium text-white/85 underline decoration-white/40 underline-offset-[3px]">
      {children}
    </Link>
  );
}

/** The "or" rule between the provider buttons and the email form. */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="mt-4 flex w-full items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-white/30" />
      <span className="text-tiny font-medium uppercase tracking-[0.16em] text-white/75">{label}</span>
      <span className="h-px flex-1 bg-white/30" />
    </div>
  );
}
