import { PageOverlay } from "@/components/layout/page-overlay";
import { NotificationsPageClient } from "@/components/features/notifications/notifications-page-client";
import { NOTIFICATION_FEED } from "@/config/product";
import { requireActiveUser } from "@/server/auth/current-user";
import { getNotificationFeed } from "@/server/notifications/feed";

export const metadata = { title: "Notifications" };
// One member's own rows: never cached and never shared between users.
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const actor = await requireActiveUser();
  const feed = await getNotificationFeed(actor, { limit: NOTIFICATION_FEED.pageSize });
  return (
    <PageOverlay title="Notifications" backHref="/discover">
      <NotificationsPageClient initial={feed} />
    </PageOverlay>
  );
}
