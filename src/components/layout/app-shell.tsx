import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { MainColumn } from "./main-column";
import type { NavBadges } from "./nav-items";
import { Sidebar } from "./sidebar";

/*
 * Authenticated app frame. Phone: main fills the width; the floating bottom nav overlays the content, which
 * reserves clearance via `pb-nav`. Tablet (≥ 900): sidebar 232 | main (max 640, or wide on Chats) | optional aside
 * 300 from AsideSlot. No bottom nav.
 *
 * Desktop (≥ 1280, the `wide` tier) is a different composition rather than the same one enlarged. The row stops
 * being centred, so the sidebar is pinned to the left edge instead of floating in mid-viewport with dead space on
 * both sides; the sidebar widens to 248; and main plus any panel share one content group that is capped at
 * `--content-wide` and centred in what is left, with `--page-gutter-wide` gutters. Each screen then composes
 * inside that group — a deck and a panel, a feed and a context column, a card grid — instead of stretching a
 * phone column. Screens keep their own maximum widths so no single row is dragged across the whole display.
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
    <div className="fixed inset-0 flex justify-center overflow-hidden bg-background text-text wide:justify-start">
      <Sidebar badges={badges} />
      <div className="flex min-w-0 flex-1 wide:mx-auto wide:max-w-[var(--content-wide)] wide:px-[var(--page-gutter-wide)]">
        <MainColumn wide={wideMain}>
          {children}
          <BottomNav badges={badges} hidden={hideBottomNav} />
        </MainColumn>
        {aside}
      </div>
    </div>
  );
}
