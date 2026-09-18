import { AppScreen, ScrollArea } from "@/components/layout/page";
import { TabHeader } from "@/components/layout/screen-header";
import { requireActiveUser } from "@/server/auth/current-user";
import { getLikesPage } from "@/server/likes/likes-page";
import { getMyProfileSummary } from "@/server/profiles/me";
import { LikesClient } from "./likes-client";

export const metadata = { title: "Likes" };
// Personalised, tier-dependent data: never cached or shared between users.
export const dynamic = "force-dynamic";

export default async function LikesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActiveUser();
  const sp = await searchParams;
  const [page, me] = await Promise.all([getLikesPage(actor), getMyProfileSummary(actor)]);
  const myPhoto = me.primaryPhoto ? { url: me.primaryPhoto.url, thumbUrl: me.primaryPhoto.url, key: me.primaryPhoto.key, blurhash: me.primaryPhoto.blurhash } : null;
  return (
    <AppScreen aria-label="Likes">
      <TabHeader title="Likes" />
      <ScrollArea>
        <LikesClient initial={page} initialTab={sp.tab === "matches" ? "matches" : "you"} myPhoto={myPhoto} />
      </ScrollArea>
    </AppScreen>
  );
}
