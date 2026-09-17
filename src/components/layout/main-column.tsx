"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Main column width follows the route (prototype): Chats uses the wide master-detail layout, Settings and Privacy &
 * Safety widen to 900 px on desktop, every other screen stays at 640.
 */
export function MainColumn({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const pathname = usePathname();
  const isChats = wide || pathname.startsWith("/chats");
  const isSettingsWide = pathname === "/settings" || pathname === "/settings/privacy";
  return (
    <main className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden", !isChats && (isSettingsWide ? "desktop:max-w-[var(--settings-max)]" : "desktop:max-w-[var(--content-max)]"))}>
      {children}
    </main>
  );
}
