"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { CounterBadge } from "@/components/ui/badge";
import { NAV_ITEMS, activeNavKey, type NavBadges } from "./nav-items";

/*
 * Floating bottom nav: absolute, left/right 16, bottom 8 + safe, height 56, radius 32, glass + blur, shadow-lg,
 * max-width 480 centred. Items 44 px tall / min 52 wide, radius 16, 20 px icon + 11.5 px label; active = tinted
 * background, text colour, 500 label. Badge pill at top-right of the item.
 *
 * Compact pass (docs/DESIGN_SYSTEM.md §32): the bar gives 8 px back to content and the active label drops from 700
 * to 500 — a nav that shouts its own current page is the clearest symptom of a heavy UI. The items stay 44 px,
 * which is the tap-target floor, so the bar is slimmer without being harder to hit.
 */
export function BottomNav({ badges = {}, hidden = false }: { badges?: NavBadges; hidden?: boolean }) {
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  // Screens that own the bottom of the viewport (a conversation, a Community thread) and the prototype's full-screen
  // page overlays (Edit profile, Preview, Settings and its sub-pages) hide the floating nav.
  const inConversation = /^\/(chats|community)\/[^/]+|^\/settings(\/|$)|^\/profile\//.test(pathname);
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "desktop:hidden absolute inset-x-4 z-20 mx-auto flex h-14 max-w-[var(--nav-max-width)] items-center justify-around rounded-nav px-1.5 glass shadow-lg",
        (hidden || inConversation) && "hidden",
      )}
      style={{ bottom: "calc(var(--nav-offset) + var(--safe-bottom))" }}
    >
      {NAV_ITEMS.map(({ key, label, href, Icon }) => {
        const isActive = active === key;
        const count = badges[key] ?? 0;
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            aria-label={count > 0 ? `${label}, ${count} new` : label}
            className={cn(
              "relative flex h-11 min-w-13 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-micro transition-colors duration-200",
              isActive ? "bg-surface-muted text-text font-medium" : "text-text-secondary",
            )}
          >
            <Icon size={20} className={isActive ? "text-text" : "text-text-secondary"} />
            <span>{label}</span>
            {count > 0 ? <CounterBadge compact count={count} className="absolute right-1.5 top-1" aria-hidden="true" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
