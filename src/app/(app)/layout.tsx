import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AsideSlot } from "@/components/layout/aside-slot";
import { RightAside } from "@/components/layout/right-aside";
import { requireActiveUser } from "@/server/auth/current-user";
import { getNavBadges } from "@/server/notifications/badges";
import { isDevelopment } from "@/lib/runtime";
import { FIXTURE_ACTIVITY, FIXTURE_NEW_MATCHES } from "@/dev/fixtures";

/**
 * Authenticated shell: only active users with completed onboarding get here (Phase 5 §21). Badges come from
 * real notifications; the Discover side panel still uses development fixtures until Phase 7.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActiveUser();
  const badges = await getNavBadges(actor);
  const discoverAside = (
    <RightAside
      matches={isDevelopment ? FIXTURE_NEW_MATCHES.map((m) => ({ name: m.name, photo: m.photos[0]! })) : []}
      activity={isDevelopment ? FIXTURE_ACTIVITY : []}
    />
  );
  return (
    <AppShell badges={badges} aside={<AsideSlot discover={discoverAside} />}>
      {children}
    </AppShell>
  );
}
