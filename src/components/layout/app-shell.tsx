import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { MainColumn } from "./main-column";
import type { NavBadges } from "./nav-items";
import { Sidebar } from "./sidebar";

/*
 * Authenticated app frame (prototype "App" screen): fixed full-viewport flex row, content centred.
 * Phone: main fills the width; floating bottom nav overlays the content, which reserves clearance via `pb-nav`.
 * Desktop (≥ 900): sidebar 232 | main (max 640, or wide on Chats) | optional aside 300 rendered by AsideSlot on routes that have one. No bottom nav.
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
      <MainColumn wide={wideMain}>
        {children}
        <BottomNav badges={badges} hidden={hideBottomNav} />
      </MainColumn>
      {aside}
    </div>
  );
}
