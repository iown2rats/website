import { BlockedClient } from "@/components/features/settings/blocked-client";
import { requireActiveUser } from "@/server/auth/current-user";
import { listBlockedUsers } from "@/server/safety/blocked";

export const metadata = { title: "Blocked users" };
export const dynamic = "force-dynamic";

export default async function BlockedPage() {
  const actor = await requireActiveUser();
  return <BlockedClient initial={await listBlockedUsers(actor)} />;
}
