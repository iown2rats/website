import { SettingsClient } from "@/components/features/settings/settings-client";
import { getDb } from "@/lib/db";
import { getAuthState, requireActiveUser } from "@/server/auth/current-user";
import { getSignInIdentity } from "@/server/auth/identity";
import { maskPhone } from "@/server/auth/phone";
import { getRecentAuthentication } from "@/server/auth/recent-auth";
import { getNotificationSettings } from "@/server/notifications/settings";
import { getPrivacySettings } from "@/server/privacy/settings";

export const metadata = { title: "Settings" };
// Private, personalised data: rendered per request for the signed-in user only.
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ confirmDelete?: string }> }) {
  const actor = await requireActiveUser();
  const state = await getAuthState();
  const sessionId = state.kind === "anonymous" ? "" : state.sessionId;
  const { confirmDelete } = await searchParams;
  const db = getDb();
  const [user, notifications, privacy, identity, recent] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phoneE164: true, verification: { select: { status: true } } } }),
    getNotificationSettings(actor, { db }),
    getPrivacySettings(actor, { db }),
    getSignInIdentity(db, actor.userId),
    getRecentAuthentication(db, sessionId),
  ]);
  return (
    <SettingsClient
      maskedPhone={user.phoneE164 ? maskPhone(user.phoneE164) : null}
      googleEmail={identity?.email ?? null}
      verificationStatus={user.verification?.status ?? "NONE"}
      notifications={notifications}
      privacy={privacy}
      recentAuth={{ fresh: recent.fresh, expiresAt: recent.expiresAt?.getTime() ?? null }}
      openDelete={confirmDelete === "1"}
    />
  );
}
