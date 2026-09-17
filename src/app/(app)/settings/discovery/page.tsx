import { DiscoveryClient } from "@/components/features/settings/discovery-client";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { getDiscoveryFilters } from "@/server/discovery/filters";

export const metadata = { title: "Discovery preferences" };
export const dynamic = "force-dynamic";

export default async function DiscoverySettingsPage() {
  const actor = await requireActiveUser();
  const db = getDb();
  const [filters, locations] = await Promise.all([
    getDiscoveryFilters(actor, { db }),
    db.location.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true } }),
  ]);
  return <DiscoveryClient initial={filters} locations={locations} />;
}
