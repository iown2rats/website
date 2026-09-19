import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/logo";
import { ROUTES } from "@/server/auth/route-access";

/** Public legal documents (docs/ARCHITECTURE.md §4.2: `/legal/*` is a public route group). */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-5 py-8 text-text">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
        <Link href={ROUTES.welcome} className="inline-flex w-fit items-center" aria-label="Back to Mellocrush">
          <Wordmark height={24} />
        </Link>
        {children}
        <Link href={ROUTES.welcome} className="text-body-sm font-medium text-text-secondary">Back to start</Link>
      </div>
    </main>
  );
}
