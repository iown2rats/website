import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { BottomNav } from "./bottom-nav";
import type { NavBadges } from "./nav-items";
import { Sidebar } from "./sidebar";

/*
 * Authenticated app frame (prototype "App" screen): fixed full-viewport flex row, content centred.
 * Phone: main fills the width; floating bottom nav overlays the content, which reserves clearance via `pb-nav`.
 * Desktop (≥ 900): sidebar 232 | main (max 640, or wider when `wideMain`) | optional aside 300. No bottom nav.
 */
export interface AppShellProps {
  children: ReactNode;
  badges?: NavBadges;
  aside?: ReactNode;
  /** Hide the phone bottom nav (conversation view, overlays). */
  hideBottomNav?: boolean;
  /** Let main grow beyond 640 (two-pane chats, settings). */
  wideMain?: boolean;
}

export function AppShell({ children, badges, aside, hideBottomNav = false, wideMain = false }: AppShellProps) {
  return (
    <div className="fixed inset-0 flex justify-center overflow-hidden bg-background text-text">
      <Sidebar badges={badges} />
      <main className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden", !wideMain && "desktop:max-w-[var(--content-max)]")}>
        {children}
        <BottomNav badges={badges} hidden={hideBottomNav} />
      </main>
      {aside ? <aside className="hidden desktop:flex w-[var(--aside-width)] shrink-0 flex-col gap-5.5 overflow-auto border-l border-border px-5.5 py-7">{aside}</aside> : null}
    </div>
  );
}
