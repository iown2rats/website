/**
 * Blocked users list and unblock (Phase 9 §16–§17). Only the blocker sees and removes their own blocks, addressed by
 * the blocked user's public handle. Unblocking removes the Block row and nothing else: no Like, Match or
 * Conversation is restored and nobody is notified; future discovery follows the normal rules.
 */
import { getDb, type Db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { authorSelect, toAuthorDto, type CommunityAuthorDto } from "@/server/community/dto";

export interface BlockedUserDto {
  handle: string;
  name: string;
  verified: boolean;
  photo: CommunityAuthorDto["photo"];
  blockedAt: string;
}

export async function listBlockedUsers(actor: Actor, deps: { db?: Db; storage?: StorageProvider } = {}): Promise<BlockedUserDto[]> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const rows = await db.block.findMany({
    where: { blockerId: actor.userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, blocked: { select: authorSelect() } },
  });
  return Promise.all(
    rows.map(async (r) => {
      const a = await toAuthorDto(storage, actor.userId, r.blocked);
      return { handle: a.handle, name: a.name, verified: a.verified, photo: a.photo, blockedAt: r.createdAt.toISOString() };
    }),
  );
}

export async function unblockUser(actor: Actor, handle: string, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const target = await db.profile.findUnique({ where: { handle }, select: { userId: true } });
  if (!target) throw new NotFoundError("User");
  const removed = await db.block.deleteMany({ where: { blockerId: actor.userId, blockedId: target.userId } });
  if (removed.count === 0) throw new NotFoundError("User");
}
