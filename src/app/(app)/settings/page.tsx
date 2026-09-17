import { SettingsClient } from "@/components/features/settings/settings-client";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { maskPhone } from "@/server/auth/phone";
import { getNotificationSettings } from "@/server/notifications/settings";
import { getPrivacySettings } from "@/server/privacy/settings";

export const metadata = { title: "Settings" };
// Private, personalised data: rendered per request for the signed-in user only.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await requireActiveUser();
  const db = getDb();
  const [user, notifications, privacy] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phoneE164: true, verification: { select: { status: true } } } }),
    getNotificationSettings(actor, { db }),
    getPrivacySettings(actor, { db }),
  ]);
  return <SettingsClient maskedPhone={maskPhone(user.phoneE164)} verificationStatus={user.verification?.status ?? "NONE"} notifications={notifications} privacy={privacy} />;
}
