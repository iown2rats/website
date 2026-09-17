import { PrivacyClient } from "@/components/features/settings/privacy-client";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { getPrivacySettings } from "@/server/privacy/settings";

export const metadata = { title: "Privacy & Safety" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const actor = await requireActiveUser();
  const db = getDb();
  const [privacy, verification] = await Promise.all([getPrivacySettings(actor, { db }), db.verification.findUnique({ where: { userId: actor.userId }, select: { status: true } })]);
  return <PrivacyClient initial={privacy} verificationStatus={verification?.status ?? "NONE"} />;
}
