import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AsideSlot } from "@/components/layout/aside-slot";
import { RightAside } from "@/components/layout/right-aside";
import { isDevelopment } from "@/lib/runtime";
import { FIXTURE_ACTIVITY, FIXTURE_BADGES, FIXTURE_NEW_MATCHES } from "@/dev/fixtures";

/**
 * Authenticated shell. Phase 4: badges and the Discover side panel come from development fixtures;
 * Phase 5+ replaces them with real read models once sessions exist.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const badges = isDevelopment ? FIXTURE_BADGES : {};
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
