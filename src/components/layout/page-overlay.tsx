import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BackButton } from "./back-button";

/*
 * Prototype "PAGE OVERLAYS" chrome (Edit profile, Privacy & Safety, Settings, Membership, Safety Center,
 * Verification): full-column page with a 48 px + safe-top header (44 px back, 16/600 title, optional trailing
 * action such as Save), body padding 4px 16px calc(20px + safe-bottom) with 14 px gaps, max-width 640 (900 for
 * Settings and Privacy on desktop, set by MainColumn), and on desktop Settings a 220 px section nav on the left.
 */
export function PageOverlay({ title, backHref, action, sideNav, children, bodyClassName }: { title: string; backHref: string; action?: ReactNode; sideNav?: ReactNode; children: ReactNode; bodyClassName?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-text animate-fade-in">
      <header className="flex shrink-0 items-center gap-1.5 px-2" style={{ height: "calc(var(--page-header-height) + var(--safe-top))", paddingTop: "var(--safe-top)" }}>
        <BackButton fallback={backHref} />
        <h1 className="min-w-0 flex-1 truncate text-prompt">{title}</h1>
        {action}
      </header>
      <div className="flex min-h-0 flex-1">
        {sideNav ? <nav aria-label="Sections" className="hidden desktop:flex w-52 shrink-0 flex-col gap-0.5 border-r border-border px-2.5 py-2">{sideNav}</nav> : null}
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden px-4 pt-1 [&>*]:shrink-0", bodyClassName)} style={{ paddingBottom: "calc(20px + var(--safe-bottom))" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
