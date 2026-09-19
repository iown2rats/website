"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { CounterBadge } from "@/components/ui/badge";
import { Wordmark } from "@/components/brand/logo";
import { NAV_ITEMS, activeNavKey, type NavBadges } from "./nav-items";
import { ThemeToggleButton } from "./theme-toggle";

/*
 * Desktop sidebar (prototype, ≥ 900 px): 232 wide, padding 28 px 18 px, right border; wordmark row padding 0 12px 24px;
 * nav rows 48 px radius 16, 15 px/600, 12 px gap, trailing badge; appearance toggle pinned to the bottom.
 */
export function Sidebar({ badges = {} }: { badges?: NavBadges }) {
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  return (
    <nav aria-label="Primary" className="hidden desktop:flex w-[var(--sidebar-width)] shrink-0 flex-col gap-1.5 border-r border-border px-4.5 py-7 wide:w-[var(--sidebar-wide)] wide:px-5">
      <Link href="/discover" className="flex items-center gap-2 px-3 pb-6 text-h3 text-text" aria-label="Mellocrush home">
        <Wordmark height={26} />
      </Link>
      {NAV_ITEMS.map(({ key, label, href, Icon }) => {
        const isActive = active === key;
        const count = badges[key] ?? 0;
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-12 items-center gap-3 rounded-lg px-3.5 text-body font-semibold transition-colors duration-150",
              isActive ? "bg-surface-muted text-text" : "text-text-secondary hover:bg-surface-muted",
            )}
          >
            <Icon size={22} className={isActive ? "text-text" : "text-text-secondary"} />
            <span>{label}</span>
            {count > 0 ? <CounterBadge count={count} className="ml-auto" aria-label={`${count} new`} /> : null}
          </Link>
        );
      })}
      <ThemeToggleButton className="mt-auto h-11 rounded-md" />
    </nav>
  );
}
