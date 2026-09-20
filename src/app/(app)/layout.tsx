import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AsideSlot } from "@/components/layout/aside-slot";
import { NotificationsProvider } from "@/components/layout/notifications-context";
import { RightAside } from "@/components/layout/right-aside";
import { relativeTime } from "@/lib/time";
import { requireActiveUser } from "@/server/auth/current-user";
import { getDiscoverAside } from "@/server/matching/aside";
import { getNavBadges } from "@/server/notifications/badges";
import { countUnreadNotifications } from "@/server/notifications/feed";
import { kickMessageEmailSweep } from "@/server/notifications/message-email";

/**
 * Authenticated shell: only active users with completed onboarding get here (Phase 5 §21). Badges, the unread
 * notification count and the Discover side panel (new matches, activity) come from the signed-in user's real rows.
 * The count is read once per request here, so the bell in every tab header starts correct without a request of
 * its own and without polling (docs/ARCHITECTURE.md §13).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActiveUser();
  /*
   * Every authenticated page render is a chance to drain the unread-message email queue, and this layout wraps all
   * of them. Hanging it off sending a message alone was not enough: a message becomes eligible ten minutes AFTER
   * it is sent, and on a small app nothing happens in between to notice. Any member opening any screen now moves
   * the queue. It is fire-and-forget behind its own one-per-minute gate, so a page render never waits on it and a
   * busy minute still costs one sweep. A scheduler calling /api/cron/message-emails is still the only thing that
   * works when nobody opens the app at all (docs/ARCHITECTURE.md §12.16).
   */
  kickMessageEmailSweep();
  const [badges, aside, unread] = await Promise.all([getNavBadges(actor), getDiscoverAside(actor), countUnreadNotifications(actor)]);
  const now = new Date();
  const discoverAside = (
    <RightAside
      matches={aside.matches.map((m) => ({ name: m.name, photo: { url: m.photo?.url ?? null, key: m.photo?.demoKey ?? null, blurhash: m.photo?.blurhash ?? null }, href: m.conversationId ? `/chats/${m.conversationId}` : "/chats" }))}
      activity={aside.activity.map((a) => ({ name: a.name, text: a.text, time: relativeTime(a.at, now), photo: { url: a.photo?.url ?? null, key: a.photo?.demoKey ?? null, blurhash: a.photo?.blurhash ?? null } }))}
    />
  );
  return (
    <NotificationsProvider unread={unread}>
      <AppShell badges={badges} aside={<AsideSlot discover={discoverAside} />}>
        {children}
      </AppShell>
    </NotificationsProvider>
  );
}
