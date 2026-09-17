"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Main column width follows the route: Chats uses the prototype's wide master-detail layout, other tabs stay at 640. */
export function MainColumn({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const pathname = usePathname();
  const isWide = wide || pathname.startsWith("/chats");
  return <main className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden", !isWide && "desktop:max-w-[var(--content-max)]")}>{children}</main>;
}
