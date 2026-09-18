/**
 * Whether email + password sign-in may be offered right now (docs/ARCHITECTURE.md §4.1b). Three conditions, all
 * required, so a half-finished deployment can never show a registration form that would break:
 *   1. the method is switched on and a provider that can really deliver is configured (`emailAuthConfigured`);
 *   2. the database carries migration 20260918190000_email_auth (the EMAIL enum value);
 *   3. the AuthToken table exists, so a verification link can be issued.
 * Same shape as the Telegram gate: a missing migration is re-checked every minute so the method appears without a
 * redeploy once the migration lands, and a present one is cached for good.
 */
import type { DbLike } from "@/lib/db";
import { emailAuthConfigured, getEnv } from "@/lib/env";

const RECHECK_MS = 60_000;
let cache: { ready: boolean; checkedAt: number } | null = null;

export async function databaseSupportsEmailAuth(db: DbLike, now = Date.now()): Promise<boolean> {
  if (cache && (cache.ready || now - cache.checkedAt < RECHECK_MS)) return cache.ready;
  let ready = false;
  try {
    const rows = await db.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'AuthProvider' AND e.enumlabel = 'EMAIL'
        AND to_regclass('"AuthToken"') IS NOT NULL
      LIMIT 1`;
    ready = rows.length > 0;
  } catch (e) {
    console.warn("[auth] email readiness check failed:", e instanceof Error ? e.message : e);
  }
  cache = { ready, checkedAt: now };
  return ready;
}

/** Environment and database both ready. */
export async function emailAuthAvailable(db: DbLike): Promise<boolean> {
  if (!emailAuthConfigured(getEnv())) return false;
  return databaseSupportsEmailAuth(db);
}

/** Test hook. */
export function resetEmailAvailabilityCache(): void {
  cache = null;
}
