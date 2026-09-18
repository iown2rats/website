/**
 * Database-backed sessions (docs/ARCHITECTURE.md §4.2).
 * The browser holds an opaque 256-bit token; the database stores only its SHA-256.
 */
import { createHash, randomBytes } from "node:crypto";
import type { DbLike } from "@/lib/db";

export const SESSION_RULES = {
  idleMs: 30 * 24 * 3_600_000,
  absoluteMs: 90 * 24 * 3_600_000,
  /** Sliding expiry is written at most this often to avoid a write on every request. */
  refreshEveryMs: 3_600_000,
} as const;

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  sessionId: string;
}

export function hashSessionToken(token: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHash("sha256").update(token).digest());
}

/** /24 (IPv4) or /48 (IPv6) prefix only: enough for anomaly review, not a precise location. */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::";
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : null;
}

export async function createSession(db: DbLike, userId: string, meta: SessionMeta = {}, now: Date = new Date()): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_RULES.idleMs);
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      absoluteExpiresAt: new Date(now.getTime() + SESSION_RULES.absoluteMs),
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
      ipPrefix: ipPrefix(meta.ip),
    },
    select: { id: true },
  });
  return { token, expiresAt, sessionId: session.id };
}

export interface SessionUser {
  id: string;
  role: "USER" | "MODERATOR" | "ADMIN";
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";
  onboardingStage: string;
  onboardingCompletedAt: Date | null;
  /**
   * True only for an EMAIL identity whose address is still unconfirmed (docs/ARCHITECTURE.md §4.1b). Google and
   * Telegram accounts are always false: this flow never applies to them.
   */
  emailVerificationPending: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
  expiresAt: Date;
}

export type UserAuthKind = "onboarding" | "active" | "blocked" | "unverified";

/**
 * Pure classification shared by the request-scoped auth state and tests. "unverified" comes before everything but
 * "blocked": an email account that has not confirmed its address holds a session and nothing else, so it can never
 * be read as onboarding or active anywhere in the app.
 */
export function authKindForUser(user: Pick<SessionUser, "status" | "onboardingCompletedAt"> & { emailVerificationPending?: boolean }): UserAuthKind {
  if (user.status === "SUSPENDED" || user.status === "BANNED" || user.status === "DELETED") return "blocked";
  if (user.emailVerificationPending) return "unverified";
  if (user.status === "ACTIVE" && user.onboardingCompletedAt) return "active";
  return "onboarding";
}

/**
 * Validates a token: unknown, idle-expired or absolutely-expired sessions return null (and expired rows
 * are removed). Slides the idle expiry forward at most once per hour.
 */
/**
 * Resolves a session token. The hourly sliding refresh is a write the response never needs to wait for; a caller in a
 * request scope passes `defer` (Next's `after`) so the update runs once the response has been sent. Without `defer`
 * the write is awaited, which is what tests and non-request callers want.
 */
export async function resolveSession(db: DbLike, token: string | null | undefined, now: Date = new Date(), defer?: (work: () => Promise<unknown>) => void): Promise<ResolvedSession | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const tokenHash = hashSessionToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      absoluteExpiresAt: true,
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          onboardingStage: true,
          onboardingCompletedAt: true,
          // One EMAIL identity that is still unconfirmed is enough to hold the account back (§4.1b). Selected in the
          // same query as the session, so this costs no extra round trip.
          identities: { where: { provider: "EMAIL", emailVerified: false, releasedAt: null }, select: { id: true }, take: 1 },
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime() || session.absoluteExpiresAt.getTime() <= now.getTime()) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  let expiresAt = session.expiresAt;
  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_RULES.refreshEveryMs) {
    expiresAt = new Date(Math.min(now.getTime() + SESSION_RULES.idleMs, session.absoluteExpiresAt.getTime()));
    const refresh = () => db.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt } });
    if (defer) defer(refresh);
    else await refresh();
  }
  const { identities, ...user } = session.user;
  return { sessionId: session.id, user: { ...user, emailVerificationPending: identities.length > 0 }, expiresAt };
}

export async function revokeSession(db: DbLike, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const result = await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  return result.count > 0;
}

export async function revokeAllSessions(db: DbLike, userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } });
  return result.count;
}

export async function pruneExpiredSessions(db: DbLike, now: Date = new Date()): Promise<number> {
  const result = await db.session.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { absoluteExpiresAt: { lte: now } }] } });
  return result.count;
}
