/**
 * Whether "Continue with Telegram" may be offered right now (docs/ARCHITECTURE.md §4.1). Two conditions:
 *  1. the environment has the Telegram client (or the development identity provider stands in), and
 *  2. the database carries migration 20260918160000_telegram_auth (the TELEGRAM enum value exists).
 * The second guard keeps a deployment that ships the code and variables before the hosted migration from
 * showing a button whose sign-in would fail at the identity insert. A missing migration is re-checked every
 * minute so the button appears without a redeploy once the migration lands; a present one is cached for good.
 */
import type { DbLike } from "@/lib/db";
import { getEnv, telegramLoginEnabled } from "@/lib/env";

const RECHECK_MS = 60_000;
let cache: { ready: boolean; checkedAt: number } | null = null;

export async function databaseSupportsTelegram(db: DbLike, now = Date.now()): Promise<boolean> {
  if (cache && (cache.ready || now - cache.checkedAt < RECHECK_MS)) return cache.ready;
  let ready = false;
  try {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AuthProvider' AND e.enumlabel = 'TELEGRAM' LIMIT 1`;
    ready = rows.length > 0;
  } catch (e) {
    console.warn("[auth] telegram readiness check failed:", e instanceof Error ? e.message : e);
  }
  cache = { ready, checkedAt: now };
  return ready;
}

/** Environment and database both ready. */
export async function telegramSignInAvailable(db: DbLike): Promise<boolean> {
  if (!telegramLoginEnabled(getEnv())) return false;
  return databaseSupportsTelegram(db);
}

/** Test hook. */
export function resetTelegramAvailabilityCache(): void {
  cache = null;
}
