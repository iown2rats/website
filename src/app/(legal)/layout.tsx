import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";
import { ROUTES } from "@/server/auth/route-access";

/**
 * The public legal documents — /terms, /privacy, /community-guidelines (docs/ARCHITECTURE.md §27).
 *
 * A route group, so the URLs stay at the root: these are the addresses that go on an app-store listing, in an
 * email footer and in a regulator's form, and they should be short and permanent.
 *
 * Readable by anyone, signed in or not. The measure is capped at 680px — wider than the app's 640px reading column
 * because these documents are dense and benefit from the extra characters per line, but nowhere near the full
 * width of a desktop window, where a 1920px line of legal prose is unreadable.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background text-text">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-7 px-5 py-8 desktop:py-12">
        <Link href={ROUTES.welcome} className="inline-flex w-fit items-center" aria-label="Mellocrush home">
          <Wordmark height={24} />
        </Link>
        {children}
      </div>
    </main>
  );
}
