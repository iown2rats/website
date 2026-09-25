import { DiscoverClient } from "@/components/features/discovery/discover-client";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { getDeck } from "@/server/discovery/deck";
import { getDiscoveryFilters } from "@/server/discovery/filters";
import { getVerificationReminder } from "@/server/verification/reminder";

export const metadata = { title: "Discover" };
// Personalised, cookie-scoped data: never statically rendered or shared between users.
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const actor = await requireActiveUser();
  const db = getDb();
  const [deck, filters, locations, verificationReminder] = await Promise.all([
    getDeck(actor),
    getDiscoveryFilters(actor, { db }),
    db.location.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true } }),
    getVerificationReminder(db, actor.userId),
  ]);
  return <DiscoverClient initial={deck} filters={filters} locations={locations} verificationReminder={verificationReminder} />;
}
