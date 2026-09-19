"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * The side panel column. Discover has carried it since the tablet layout (300 px, 320 at the desktop tier).
 * Community gets the same panel at the desktop tier only (312 px): its feed is capped at a readable measure, and
 * without a second column the remaining width would be dead space. The content — new matches and recent activity —
 * is the data the app layout already loads, so this composes existing features rather than inventing one.
 * Routes without a panel get the full content width.
 */
export function AsideSlot({ discover }: { discover: ReactNode }) {
  const pathname = usePathname();
  const onDiscover = pathname === "/discover" || pathname.startsWith("/discover/");
  const onCommunity = pathname === "/community";
  if (!onDiscover && !onCommunity) return null;
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col gap-5.5 overflow-auto border-l border-border py-7",
        // Discover has carried this panel since the tablet layout. Community gains one only at the desktop tier,
        // where a 690 px feed would otherwise sit beside several hundred pixels of nothing.
        onDiscover ? "desktop:flex w-[var(--aside-width)] px-5.5 wide:w-[var(--aside-wide)] wide:px-6" : "wide:flex w-[var(--feed-aside-wide)] px-6",
      )}
    >
      {discover}
    </aside>
  );
}
