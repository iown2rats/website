import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { ROUTES } from "@/server/auth/route-access";
import type { WelcomeCoverView } from "@/server/welcome/cover";

/*
 * The shell every signed-out auth screen shares (DESIGN_SYSTEM §26/§37): the admin-managed cover photograph, and
 * the controls sitting directly on it. The welcome screen, registration, "verify your email", "forgot password" and
 * "reset password" all render inside it, so the whole flow looks like one place.
 *
 * There is no card. The form is grouped semantically — one <section> with an accessible name — but nothing is
 * drawn around it, so the photograph runs edge to edge behind the controls and the depth of each control is what
 * separates it from the image (glass-field.tsx).
 */
const HERO_SIZES = "100vw";

/**
 * The cover, art-directed. One `<picture>`, three shapes, and the browser downloads exactly one of them: the
 * `<source>` list runs widest-first, so the first matching `media` wins and everything below it is never fetched
 * (src/server/welcome/variants.ts owns those breakpoints).
 *
 * `object-fit: cover` does the rest. Whatever the viewport is — a phone held sideways, a tablet, a 4K monitor — the
 * image fills it, keeps its proportions and is cropped rather than stretched, and the placeholder painted behind it
 * means the area is never blank while it loads. Intrinsic width/height on every candidate keeps the box reserved,
 * so nothing shifts when the photograph arrives.
 *
 * A plain `<img>` rather than next/image: this is the largest-contentful-paint element on the first screen a
 * stranger sees, and next/image would put an optimizer hop in front of it. The built-in covers are pre-rendered at
 * several widths in AVIF and WebP; an uploaded cover is one WebP that the server already resized.
 */
export function AuthBackdrop({ cover, priority = false }: { cover: WelcomeCoverView; priority?: boolean }) {
  // The last entry is the one with no media query: `<picture>`'s required fallback, which must be the <img>.
  const fallback = cover.images[cover.images.length - 1]!;
  const sources = cover.images.slice(0, -1);
  return (
    <>
      {/* One preload per variant, each with its own self-contained media query, so a desktop visitor preloads the
          desktop file and nothing else. Without the query the phone image would be fetched on every device. */}
      {priority
        ? cover.images.map((img) => (
            <link
              key={img.variant}
              rel="preload"
              as="image"
              media={img.preloadMedia}
              type={img.avifSrcSet ? "image/avif" : "image/webp"}
              imageSrcSet={img.avifSrcSet ?? img.webpSrcSet}
              imageSizes={HERO_SIZES}
              fetchPriority="high"
            />
          ))
        : null}
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${fallback.placeholder}")` }}>
        <picture>
          {sources.map((img) => (
            <Fragment key={img.variant}>
              {img.avifSrcSet ? <source media={img.media ?? undefined} type="image/avif" srcSet={img.avifSrcSet} sizes={HERO_SIZES} width={img.width} height={img.height} /> : null}
              <source media={img.media ?? undefined} type="image/webp" srcSet={img.webpSrcSet} sizes={HERO_SIZES} width={img.width} height={img.height} />
            </Fragment>
          ))}
          {fallback.avifSrcSet ? <source type="image/avif" srcSet={fallback.avifSrcSet} sizes={HERO_SIZES} /> : null}
          <img
            src={fallback.src}
            srcSet={fallback.webpSrcSet}
            sizes={HERO_SIZES}
            width={fallback.width}
            height={fallback.height}
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
  /** The cover to paint. Every signed-out screen is handed the same one, so the flow never changes background. */
  cover: WelcomeCoverView;
  /** The welcome screen preloads the photograph; the rest inherit it from the cache. */
  priority?: boolean;
  /** Heading id for the card's `aria-labelledby`. */
  labelledBy: string;
  className?: string;
}

export function AuthShell({ children, below, cover, priority = false, labelledBy, className }: AuthShellProps) {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#050d14] text-white">
      <AuthBackdrop cover={cover} priority={priority} />
      {/* The page, darkened. Full bleed and edgeless on purpose: a cover is whatever an admin uploaded, and this has
          to carry white type over a white sail or a midday lagoon without ever reading as a panel behind the form. */}
      <div aria-hidden="true" className="absolute inset-0 z-[1] auth-scrim" />
      {/* The column is centred on BOTH axes: the stack sits in the middle of the screen rather than hanging from
          the top with the photograph left to fill the bottom third. `justify-center-safe` is what makes that safe —
          on a short viewport (or with the keyboard up) centring would push the wordmark off the top edge where a
          person could never reach it, and `safe` falls back to top-aligned the moment the content stops fitting.
          The paddings are therefore minimum gutters, not the layout: they only bite once the screen is full. */}
      <div
        className="relative z-[2] flex flex-1 flex-col items-center justify-center-safe px-5"
        style={{ paddingTop: "calc(4dvh + var(--safe-top))", paddingBottom: "calc(4dvh + var(--safe-bottom))" }}
      >
        {/* Still a section with a name, so the form is one landmark to a screen reader. It just has no walls. */}
        <section aria-labelledby={labelledBy} className={cn("flex w-full max-w-[344px] flex-col items-center text-center md:max-w-[364px]", className)}>
          {children}
        </section>
        {below ? <div className="mt-5 w-full max-w-[344px] text-center md:max-w-[364px]">{below}</div> : null}
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
        <h1 id={id} className="auth-legible mt-2.5 text-h4 font-medium leading-tight tracking-[-0.01em] text-white">
          {title}
        </h1>
      ) : (
        <h1 id={id} className="sr-only">
          Mellocrush
        </h1>
      )}
      {subtitle ? <p className="auth-legible mt-1.5 text-body-sm leading-relaxed text-white/85">{subtitle}</p> : null}
    </>
  );
}

/** "Closer than you think" — the welcome screen's tagline, in the supplied treatment. */
export function AuthTagline() {
  return <p className="auth-legible mt-2 text-tiny font-medium uppercase tracking-[0.18em] text-white/80">Closer than you think</p>;
}

export function AuthLegalLine() {
  return (
    <p className="auth-legible mt-4 text-tiny leading-relaxed text-white/80">
      By continuing, you agree to our
      <br />
      <Link href={ROUTES.terms} className="font-medium text-white underline decoration-white/70 underline-offset-[3px]">
        Terms &amp; Conditions
      </Link>{" "}
      and{" "}
      <Link href={ROUTES.privacy} className="font-medium text-white underline decoration-white/70 underline-offset-[3px]">
        Privacy Policy
      </Link>
      .
    </p>
  );
}

export function AuthBackLink({ href = ROUTES.welcome, children = "Back to sign in" }: { href?: string; children?: ReactNode }) {
  return (
    <Link href={href} className="auth-legible inline-flex h-10 items-center justify-center text-body font-medium text-white/90 underline decoration-white/45 underline-offset-[3px]">
      {children}
    </Link>
  );
}

/** The "or" rule between the provider buttons and the email form. */
export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="mt-4 flex w-full items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-white/30" />
      <span className="auth-legible text-tiny font-medium uppercase tracking-[0.16em] text-white/80">{label}</span>
      <span className="h-px flex-1 bg-white/30" />
    </div>
  );
}
