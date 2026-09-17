"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { CounterBadge } from "@/components/ui/badge";
import { NAV_ITEMS, activeNavKey, type NavBadges } from "./nav-items";

/*
 * Floating bottom nav (prototype): absolute, left/right 16, bottom 10 + safe, height 64, radius 32, glass + blur 20,
 * 1 px border, shadow-lg, max-width 480 centred. Items 48 px tall / min 56 wide, radius 16, 22 px icon + 12 px label;
 * active = aqua-soft background, text colour, ocean icon, 700 label. Badge pill at top-right of the item.
 */
export function BottomNav({ badges = {}, hidden = false }: { badges?: NavBadges; hidden?: boolean }) {
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  // Screens whose composer owns the bottom of the viewport (a conversation, a Community post thread) hide the nav.
  const inConversation = /^\/(chats|community)\/[^/]+/.test(pathname);
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "desktop:hidden absolute inset-x-4 z-20 mx-auto flex h-16 max-w-[var(--nav-max-width)] items-center justify-around rounded-nav border border-border px-2 glass shadow-lg",
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
              "relative flex h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-micro transition-colors duration-200",
              isActive ? "bg-aqua-soft text-text font-bold" : "text-text-secondary font-semibold",
            )}
          >
            <Icon size={22} className={isActive ? "text-ocean" : "text-text-secondary"} />
            <span>{label}</span>
            {count > 0 ? <CounterBadge compact count={count} className="absolute right-2 top-1.5" aria-hidden="true" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
