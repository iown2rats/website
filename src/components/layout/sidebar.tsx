"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { CounterBadge } from "@/components/ui/badge";
import { Wordmark } from "@/components/brand/logo";
import { NAV_ITEMS, activeNavKey, type NavBadges } from "./nav-items";
import { ThemeToggleButton } from "./theme-toggle";

/*
 * Desktop sidebar (≥ 900 px): 232 wide, right border; wordmark row above the items; nav rows 44 px radius 16,
 * 14 px/500 with a 20 px icon and a trailing badge; appearance toggle pinned to the bottom. Compact pass (§32).
 */
export function Sidebar({ badges = {} }: { badges?: NavBadges }) {
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  return (
    <nav aria-label="Primary" className="hidden desktop:flex w-[var(--sidebar-width)] shrink-0 flex-col gap-1 border-r border-border px-3.5 py-5 wide:w-[var(--sidebar-wide)] wide:px-4">
      <Link href="/discover" className="flex items-center gap-2 px-3 pb-4 text-h3 text-text" aria-label="Mellocrush home">
        <Wordmark height={22} />
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
              "flex h-11 items-center gap-3 rounded-lg px-3 text-body font-medium transition-colors duration-150",
              isActive ? "bg-surface-muted text-text" : "text-text-secondary hover:bg-surface-muted",
            )}
          >
            <Icon size={20} className={isActive ? "text-text" : "text-text-secondary"} />
            <span>{label}</span>
            {count > 0 ? <CounterBadge count={count} className="ml-auto" aria-label={`${count} new`} /> : null}
          </Link>
        );
      })}
      <ThemeToggleButton className="mt-auto h-10 rounded-md" />
    </nav>
  );
}
