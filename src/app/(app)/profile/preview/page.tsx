import { PreviewProfile } from "@/components/features/profile/preview-profile";
import { getDb } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";
import { requireActiveUser } from "@/server/auth/current-user";
import { buildDiscoveryCards } from "@/server/discovery/dto";

export const metadata = { title: "Preview" };
export const dynamic = "force-dynamic";

/**
 * "Preview": the owner's profile exactly as another member receives it — the same safe DTO builder as Discover,
 * so hidden age, hidden location and the photo visibility policy apply and nothing private is rendered.
 */
export default async function PreviewPage() {
  const actor = await requireActiveUser();
  const [card] = await buildDiscoveryCards(getDb(), actor.userId, [actor.userId], new Date(), getStorageProvider(), { requireMinPhotos: false });
  return <PreviewProfile card={card ?? null} />;
}
