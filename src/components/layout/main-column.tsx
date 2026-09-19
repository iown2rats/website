"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Main column width follows the route. Chats uses the master-detail layout; Settings and Privacy & Safety widen to
 * 900 on tablet; every other screen stays at 640 there.
 *
 * At the `wide` tier the cap is lifted entirely: main fills the content group set by AppShell, and each screen
 * decides its own composition inside it (a deck beside a panel, a feed beside a context column, a card grid). The
 * one exception is the settings pages, where a row dragged across 1100 px reads worse than a bounded column.
 */
export function MainColumn({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const pathname = usePathname();
  const isChats = wide || pathname.startsWith("/chats");
  const isSettingsWide = pathname === "/settings" || pathname === "/settings/privacy";
  return (
    <main className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden", !isChats && (isSettingsWide ? "desktop:max-w-[var(--settings-max)] wide:mx-auto" : "desktop:max-w-[var(--content-max)] wide:max-w-none"))}>
      {children}
    </main>
  );
}
