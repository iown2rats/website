"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders the desktop right panel (300 px, prototype: Discover only) including its column, so routes without a
 * panel (Chats master–detail, Likes, Profile) get the full main width. Content comes from the server layout.
 */
export function AsideSlot({ discover }: { discover: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/discover" || pathname.startsWith("/discover/")) {
    return <aside className="hidden desktop:flex w-[var(--aside-width)] shrink-0 flex-col gap-5.5 overflow-auto border-l border-border px-5.5 py-7">{discover}</aside>;
  }
  return null;
}
