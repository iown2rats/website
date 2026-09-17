import { CommunityFeed } from "@/components/features/community/community-feed";
import { COMMUNITY } from "@/config/product";
import { getDb } from "@/lib/db";
import { requireActiveUser } from "@/server/auth/current-user";
import { getFeed } from "@/server/community/feed";

export const metadata = { title: "Community" };
// Personalised (blocks, own posts, likes): rendered per request, never shared or cached.
export const dynamic = "force-dynamic";

/** Community feed (Phase 8): the first For You page is server-rendered; the client pages through the rest. */
export default async function CommunityPage() {
  const actor = await requireActiveUser();
  const db = getDb();
  const now = new Date();
  const [feed, me] = await Promise.all([
    getFeed(actor, { tab: "FOR_YOU" }, { db, now }).catch((e: unknown) => {
      console.error("[community] initial feed failed", e);
      return null;
    }),
    db.user.findUnique({ where: { id: actor.userId }, select: { privacy: { select: { invisibleMode: true, hideLocation: true } }, profile: { select: { location: { select: { name: true } } } } } }),
  ]);
  const canPost = COMMUNITY.invisibleModeParticipation === "ALLOWED" || !me?.privacy?.invisibleMode;
  const island = me?.privacy?.hideLocation ? null : (me?.profile?.location?.name ?? null);
  return <CommunityFeed initial={feed} serverNow={now.toISOString()} island={island} canPost={canPost} />;
}
