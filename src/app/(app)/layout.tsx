import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AsideSlot } from "@/components/layout/aside-slot";
import { RightAside } from "@/components/layout/right-aside";
import { relativeTime } from "@/lib/time";
import { requireActiveUser } from "@/server/auth/current-user";
import { getDiscoverAside } from "@/server/matching/aside";
import { getNavBadges } from "@/server/notifications/badges";

/**
 * Authenticated shell: only active users with completed onboarding get here (Phase 5 §21). Badges and the Discover
 * side panel (new matches, activity) come from the signed-in user's real rows.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActiveUser();
  const [badges, aside] = await Promise.all([getNavBadges(actor), getDiscoverAside(actor)]);
  const now = new Date();
  const discoverAside = (
    <RightAside
      matches={aside.matches.map((m) => ({ name: m.name, photo: { url: m.photo?.url ?? null, key: m.photo?.demoKey ?? null, blurhash: m.photo?.blurhash ?? null }, href: m.conversationId ? `/chats/${m.conversationId}` : "/chats" }))}
      activity={aside.activity.map((a) => ({ name: a.name, text: a.text, time: relativeTime(a.at, now), photo: { url: a.photo?.url ?? null, key: a.photo?.demoKey ?? null, blurhash: a.photo?.blurhash ?? null } }))}
    />
  );
  return (
    <AppShell badges={badges} aside={<AsideSlot discover={discoverAside} />}>
      {children}
    </AppShell>
  );
}
