/**
 * Transaction-scoped advisory locks (Postgres `pg_advisory_xact_lock`), released automatically at commit/rollback.
 * A pair lock serialises everything that changes the relationship between two users (like → match, block),
 * so a block can never race a mutual like into an ACTIVE match (docs/ARCHITECTURE.md §8, §10).
 */
import type { Tx } from "@/lib/db";
import { sortPair } from "@/server/actor";

/** Lock ordering rule: usage-counter row locks first, then the pair lock. Nothing takes them in the other order. */
export async function lockPair(tx: Tx, a: string, b: string): Promise<void> {
  const pair = sortPair(a, b);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"pair:" + pair.userAId + ":" + pair.userBId}))`;
}
