import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/logo";

/*
 * The signed-out half of the admin portal (docs/DESIGN_SYSTEM.md §18, docs/ARCHITECTURE.md §22.1).
 *
 * Deliberately not the member `AuthShell`: no night-beach photograph, no frosted glass, no tagline, no provider
 * buttons, no legal footer, no link back into the dating app. This is the front door of an operations tool, so it
 * is a single card on the ordinary page surface — the same warm background, the same Plus Jakarta Sans, the same
 * 44px controls as the rest of the admin area, and nothing that reads as romantic.
 *
 * It also says as little as possible. The heading names the portal and nothing else; whether an address is staff,
 * whether an invitation exists and whether a reset was sent are all invisible from here.
 */
export function StaffPortalShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background text-text flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px] flex flex-col gap-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <BrandMark size={40} />
          <div className="flex flex-col gap-1">
            <h1 className="text-title-sm font-semibold tracking-[-0.02em]">{title}</h1>
            {subtitle ? <p className="text-body-sm text-text-secondary">{subtitle}</p> : null}
          </div>
        </header>
        <div className="rounded-xl bg-surface p-5 sm:p-6">{children}</div>
        {footer ? <div className="text-center text-caption text-text-secondary">{footer}</div> : null}
      </div>
    </main>
  );
}
