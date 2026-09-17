/**
 * Safe public profile reached from a Community author (Phase 8 §16). Authorised by relationship only: the person
 * must be ACTIVE and neither side blocked (contact blocking included). Built from VisibleProfile, so hideAge,
 * hideLocation and the photo policy apply. Viewing never creates dating eligibility; a dating Like from this
 * profile must go through the Phase 6 like path and its allowance.
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { buildDiscoveryCards, type DiscoveryCardDto } from "@/server/discovery/dto";
import { noBlockOrContactSql } from "@/server/discovery/predicate";

export async function getCommunityProfile(actor: Actor, handle: string, deps: { db?: Db; storage?: StorageProvider; now?: Date } = {}): Promise<DiscoveryCardDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const viewer = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phoneHash: true } });
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id FROM "User" u JOIN "Profile" pr ON pr."userId" = u.id
    WHERE pr.handle = ${handle} AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL AND ${noBlockOrContactSql(actor.userId, viewer.phoneHash)}
    LIMIT 1
  `);
  const id = rows[0]?.id;
  if (!id) throw new NotFoundError("Profile");
  const [card] = await buildDiscoveryCards(db, actor.userId, [id], now, storage, { requireMinPhotos: false });
  if (!card) throw new NotFoundError("Profile");
  return card;
}
