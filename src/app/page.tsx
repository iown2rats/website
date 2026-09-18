import { redirect } from "next/navigation";
import { ContinueWithGoogle, ContinueWithTelegram } from "@/components/features/auth/google-button";
import { Wordmark } from "@/components/brand/logo";
import { getDb } from "@/lib/db";
import { getAuthState } from "@/server/auth/current-user";
import { telegramSignInAvailable } from "@/server/auth/telegram-availability";
import { ROUTES } from "@/server/auth/route-access";

/*
 * Mellocrush welcome screen: one full-screen photograph (a Maldivian beach at night under the Milky Way, a couple on the sand),
 * the wordmark, one headline and the sign-in buttons (Continue with Google, and Continue with Telegram when the
 * Telegram client is configured). Nothing else — the picture does the storytelling.
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
      {/* Photograph. object-position keeps the Milky Way and the couple in frame on phones; on wide screens the band
          around the horizon and the couple is shown, and the content sits top-left over the palms. */}
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
      {/* Readability scrims: a whisper over the top-left where the wordmark sits, a firmer one behind the button on
          the sand. The Milky Way (top right) and the water are left alone. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[38%] bg-[linear-gradient(180deg,rgba(5,13,20,0.5)_0%,rgba(5,13,20,0.18)_55%,rgba(5,13,20,0)_100%)] md:hidden" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[30%] bg-[linear-gradient(180deg,rgba(5,13,20,0)_0%,rgba(5,13,20,0.5)_55%,rgba(5,13,20,0.82)_100%)] md:hidden" />
      <div aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-[62%] bg-[linear-gradient(90deg,rgba(5,13,20,0.72)_0%,rgba(5,13,20,0.35)_55%,rgba(5,13,20,0)_100%)] md:block" />

      {/* Phones: wordmark + headline top-left over the palms, the button at the bottom on the sand, the couple and the
          sky untouched in between. Wide screens: everything grouped top-left, the couple and the Milky Way clear. */}
      <div
        className="relative z-[1] flex min-h-0 flex-1 flex-col px-5 md:mt-[13vh] md:mb-auto md:ml-[7vw] md:max-w-[460px] md:flex-none md:px-0 md:pt-0"
        style={{ paddingTop: "calc(28px + var(--safe-top))", paddingBottom: "calc(24px + var(--safe-bottom))" }}
      >
        <div className="flex w-full max-w-[var(--onboarding-max)] flex-col gap-3 self-center md:gap-4 md:self-start">
          {/* The artwork is cocoa on transparent, so over the night photograph it sits on a small warm-white glass tile. */}
          <div className="inline-flex self-start items-center rounded-lg px-3 py-2 glass-card">
            <Wordmark height={22} priority />
          </div>
          <h1 className="text-hero md:text-[44px] md:leading-[1.04]">Meet someone closer to home.</h1>
        </div>
        <div className="mt-auto w-full max-w-[var(--onboarding-max)] self-center md:mt-7 md:self-start">
          <div className="flex flex-col gap-3">
            <ContinueWithGoogle className="h-14 rounded-xl shadow-lg" />
            {telegram ? <ContinueWithTelegram className="h-14 rounded-xl shadow-lg" /> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
