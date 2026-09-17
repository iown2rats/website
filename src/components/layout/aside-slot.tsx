"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders the desktop right panel only on routes that have one (prototype: Discover only).
 * The panel content is passed from the server layout so it can use server data later.
 */
export function AsideSlot({ discover }: { discover: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/discover" || pathname.startsWith("/discover/")) return <>{discover}</>;
  return null;
}
