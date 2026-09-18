import Link from "next/link";
import { redirect } from "next/navigation";
import { ContinueWithGoogle, ContinueWithTelegram } from "@/components/features/auth/google-button";
import { Wordmark } from "@/components/brand/logo";
import { getDb } from "@/lib/db";
import { getAuthState } from "@/server/auth/current-user";
import { telegramSignInAvailable } from "@/server/auth/telegram-availability";
import { ROUTES } from "@/server/auth/route-access";

/*
 * Mellocrush welcome screen: one full-screen photograph (a Maldivian beach at night under the Milky Way, a couple on the sand)
 * and one centred frosted-glass card: the white wordmark, the tagline "Real people. Brighter days.", Continue with
 * Google (white pill) and Continue with Telegram (Telegram-blue pill, when configured), an "or" rule and the legal line
 * linking to /legal/terms and /legal/privacy. Nothing else — the picture does the storytelling (design: DESIGN_SYSTEM §26).
 *
 * The hero is served as pre-rendered static files (public/hero, made by scripts/render-hero.mjs from the master in
 * docs/assets/hero): AVIF with a WebP fallback, four widths chosen by the browser from the viewport width, preloaded
 * from the server-rendered HTML so it is the first request after the document. No client JavaScript is involved. A
 * 24 px inline placeholder sits behind it so the screen is never blank and nothing shifts when the photo arrives.
 * The image is decorative (empty alt); the copy carries the meaning.
 */
const HERO_WIDTHS = [480, 640, 828, 941] as const;
const HERO_SIZES = "100vw";
const heroSrcSet = (ext: "avif" | "webp") => HERO_WIDTHS.map((w) => `/hero/night-beach-${w}.${ext} ${w}w`).join(", ");
const HERO_PLACEHOLDER = "data:image/webp;base64,UklGRqoAAABXRUJQVlA4IJ4AAACQBgCdASoYACsAPu1apk2ppKMiMBqtUTAdiUAXwHfJI/FDxQnfRed3atLJdFMtX2F7/Au+3GFMTmUybP8AAP76ZF+QQChNPQ40reRPEAqP5n1yXBM7QfAPyXKqLBtoq9hpI3w4iDPyYGha0elpym/mpkJ6RxRGV+NGIKIGGcu1YhpzThEAlVht7CQRcxJXg2crX1fLBYHvAn4z+JAAAA==";

export default async function WelcomePage() {
  const state = await getAuthState();
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  const telegram = await telegramSignInAvailable(getDb());

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#050d14] text-white">
      {/* Hoisted into <head> by React during server rendering, so the AVIF is requested with the document. Browsers
          without AVIF ignore a preload whose type they cannot decode and fetch the WebP from the <picture> instead. */}
      <link rel="preload" as="image" type="image/avif" imageSrcSet={heroSrcSet("avif")} imageSizes={HERO_SIZES} fetchPriority="high" />
      {/* Photograph, untouched: no scrims. The glass card carries its own contrast. */}
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
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover object-[50%_50%] md:object-[50%_60%]"
          />
        </picture>
      </div>

      {/* One frosted-glass card, centred horizontally and set in the upper part of the frame so the couple on the
          sand stays clear below it on phones; on wide screens it sits in the middle of the sky. */}
      <div
        className="relative z-[1] flex flex-1 flex-col items-center px-5 md:pt-[11vh]"
        style={{ paddingTop: "calc(15dvh + var(--safe-top))", paddingBottom: "calc(24px + var(--safe-bottom))" }}
      >
        <section
          aria-labelledby="welcome-title"
          className="flex w-full max-w-[400px] flex-col items-center rounded-[28px] border border-white/20 bg-white/12 px-6 pb-7 pt-10 text-center shadow-[0_24px_64px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 md:max-w-[440px] md:px-8 md:pb-8 md:pt-12"
        >
          <h1 id="welcome-title" className="m-0 flex justify-center">
            <Wordmark tone="light" height={38} priority />
          </h1>
          <p className="mt-3 text-[13px] font-medium uppercase tracking-[0.22em] text-white/70 md:text-sm">Real people. Brighter days.</p>

          <div className="mt-8 flex w-full flex-col gap-3.5">
            <ContinueWithGoogle shape="pill" className="h-[58px] text-[17px] shadow-[0_8px_24px_rgba(0,0,0,0.25)]" markSize={26} />
            {telegram ? <ContinueWithTelegram shape="pill" appearance="brand" className="h-[58px] text-[17px] shadow-[0_8px_24px_rgba(0,0,0,0.25)]" markSize={28} /> : null}
          </div>

          <div className="mt-7 flex w-full items-center gap-4" aria-hidden="true">
            <span className="h-px flex-1 bg-white/35" />
            <span className="text-[13px] font-medium uppercase tracking-[0.18em] text-white/85">or</span>
            <span className="h-px flex-1 bg-white/35" />
          </div>

          <p className="mt-6 text-[15px] leading-relaxed text-white/90">
            By continuing, you agree to our
            <br />
            <Link href="/legal/terms" className="font-medium text-white underline underline-offset-[3px] decoration-white/70">Terms of Service</Link> and{" "}
            <Link href="/legal/privacy" className="font-medium text-white underline underline-offset-[3px] decoration-white/70">Privacy Policy</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
