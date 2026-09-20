/**
 * Admin user management (docs/ARCHITECTURE.md §21.4). Reads expose operational facts only — never session tokens,
 * provider tokens, contact hashes, phone numbers or OAuth material. Status changes reuse the existing UserStatus
 * states; suspended and banned accounts lose their sessions immediately and cannot sign in (identity.ts).
 */
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { GRANTING_SUBSCRIPTION_STATUSES, getEntitlements } from "@/server/entitlements";
import { AUDIT_ACTIONS, writeAudit } from "./audit";
import { assertPermission, type AdminActor } from "./authz";

export type AccountStatus = "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";
export type OnboardingFilter = "all" | "complete" | "incomplete";
export type MembershipFilter = "all" | "plus" | "free";
export type VerificationFilter = "all" | "NONE" | "PENDING" | "VERIFIED" | "REJECTED";

export interface UserSearchInput {
  q?: string;
  status?: AccountStatus | "all";
  onboarding?: OnboardingFilter;
  verification?: VerificationFilter;
  membership?: MembershipFilter;
  joinedFrom?: string;
  joinedTo?: string;
  page?: number;
  pageSize?: number;
}

export interface UserRowDto {
  userId: string;
  handle: string | null;
  displayName: string | null;
  status: AccountStatus;
  role: string;
  onboardingComplete: boolean;
  verificationStatus: string;
  tier: "FREE" | "PLUS";
  createdAt: string;
  lastActiveAt: string | null;
}

const plusNowSql = (now: Date) => Prisma.sql`(
  EXISTS (SELECT 1 FROM "Subscription" s WHERE s."userId" = u.id AND s."currentPeriodEnd" > ${now} AND s.status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELLED'))
  OR EXISTS (SELECT 1 FROM "EntitlementOverride" eo WHERE eo."userId" = u.id AND eo.tier = 'PLUS' AND eo."startsAt" <= ${now} AND eo."endsAt" > ${now})
)`;

export async function searchUsers(admin: AdminActor, input: UserSearchInput, deps: { db?: Db; now?: Date } = {}): Promise<{ items: UserRowDto[]; total: number; page: number; pageSize: number }> {
  assertPermission(admin, "users.view");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  // The user directory is the *member* directory. Staff accounts have no profile, no onboarding and no dating
  // state, so listing them here would only produce blank rows and skew every filter; they live at /admin/staff
  // (docs/ARCHITECTURE.md §22.2).
  const conditions: Prisma.Sql[] = [Prisma.sql`u."accountType" = 'MEMBER'`];
  const q = input.q?.trim();
  if (q) conditions.push(Prisma.sql`(u.id = ${q} OR p.handle ILIKE ${q} OR p."displayName" ILIKE ${"%" + q + "%"})`);
  if (input.status && input.status !== "all") conditions.push(Prisma.sql`u.status = ${input.status}::"UserStatus"`);
  if (input.onboarding === "complete") conditions.push(Prisma.sql`u."onboardingCompletedAt" IS NOT NULL`);
  if (input.onboarding === "incomplete") conditions.push(Prisma.sql`u."onboardingCompletedAt" IS NULL`);
  if (input.verification && input.verification !== "all") {
    if (input.verification === "PENDING") conditions.push(Prisma.sql`v.status IN ('SELFIE_SUBMITTED','UNDER_REVIEW')`);
    else if (input.verification === "NONE") conditions.push(Prisma.sql`(v.status IS NULL OR v.status IN ('NONE','PHONE_VERIFIED'))`);
    else conditions.push(Prisma.sql`v.status = ${input.verification}::"VerificationStatus"`);
  }
  if (input.membership === "plus") conditions.push(plusNowSql(now));
  if (input.membership === "free") conditions.push(Prisma.sql`NOT ${plusNowSql(now)}`);
  const from = input.joinedFrom ? new Date(input.joinedFrom) : null;
  const to = input.joinedTo ? new Date(input.joinedTo) : null;
  if (from && !Number.isNaN(from.getTime())) conditions.push(Prisma.sql`u."createdAt" >= ${from}`);
  if (to && !Number.isNaN(to.getTime())) conditions.push(Prisma.sql`u."createdAt" < ${new Date(to.getTime() + 86_400_000)}`);
  const where = Prisma.join(conditions, " AND ");

  const [rows, totals] = await Promise.all([
    db.$queryRaw<{ id: string; handle: string | null; displayName: string | null; status: AccountStatus; role: string; onboardingCompletedAt: Date | null; verificationStatus: string | null; plus: boolean; createdAt: Date; lastActiveAt: Date | null }[]>(Prisma.sql`
      SELECT u.id, p.handle, p."displayName", u.status, u.role::text AS role, u."onboardingCompletedAt", v.status::text AS "verificationStatus", ${plusNowSql(now)} AS plus, u."createdAt", u."lastActiveAt"
      FROM "User" u
      LEFT JOIN "Profile" p ON p."userId" = u.id
      LEFT JOIN "Verification" v ON v."userId" = u.id
      WHERE ${where}
      ORDER BY u."createdAt" DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM "User" u LEFT JOIN "Profile" p ON p."userId" = u.id LEFT JOIN "Verification" v ON v."userId" = u.id WHERE ${where}`),
  ]);
  return {
    items: rows.map((r) => ({ userId: r.id, handle: r.handle, displayName: r.displayName, status: r.status, role: r.role, onboardingComplete: Boolean(r.onboardingCompletedAt), verificationStatus: r.verificationStatus ?? "NONE", tier: r.plus ? "PLUS" : "FREE", createdAt: r.createdAt.toISOString(), lastActiveAt: r.lastActiveAt?.toISOString() ?? null })),
    total: totals[0]?.n ?? 0,
    page,
    pageSize,
  };
}

export interface UserDetailDto {
  account: { userId: string; handle: string | null; displayName: string | null; status: AccountStatus; role: string; onboardingStage: string; onboardingCompletedAt: string | null; createdAt: string; lastActiveAt: string | null; deletedAt: string | null; hasPhone: boolean; ageYears: number | null; activeSessions: number };
  /** How this member signs in. `emailVerified` is null for Google and Telegram, which have no such step. Never a password or token hash. */
  signIn: { provider: "GOOGLE" | "TELEGRAM" | "EMAIL"; account: string | null; emailVerified: boolean | null; lastLoginAt: string | null } | null;
  profile: { location: string | null; intent: string | null; photos: { approved: number; pending: number; rejected: number }; bioLength: number; interests: number; prompts: number } | null;
  privacy: { paused: boolean; invisibleMode: boolean; visibility: string; blockContacts: boolean } | null;
  verification: { status: string; submittedAt: string | null; decidedAt: string | null; rejectionReason: string | null; hasSelfie: boolean };
  membership: { tier: "FREE" | "PLUS"; periodEnd: string | null; overridden: boolean; subscriptions: { id: string; planName: string; status: string; provider: string; currentPeriodStart: string; currentPeriodEnd: string; orderReference: string | null }[] };
  orders: { id: string; reference: string; status: string; planName: string; amountLabel: string; createdAt: string; submittedAt: string | null; decidedAt: string | null }[];
  safety: { reportsReceived: number; openReportsReceived: number; reportsFiled: number; blocksGiven: number; blocksReceived: number; recentReports: { id: string; reason: string; status: string; createdAt: string }[] };
  audit: { id: string; action: string; actor: string | null; createdAt: string; data: unknown }[];
}

export async function getUserDetail(admin: AdminActor, userId: string, deps: { db?: Db; now?: Date } = {}): Promise<UserDetailDto> {
  assertPermission(admin, "users.view");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, status: true, role: true, onboardingStage: true, onboardingCompletedAt: true, createdAt: true, lastActiveAt: true, deletedAt: true, phoneE164: true, dateOfBirth: true,
      profile: { select: { handle: true, displayName: true, bio: true, intent: true, location: { select: { name: true } }, photos: { select: { moderation: true } }, _count: { select: { interests: true, prompts: true } } } },
      privacy: { select: { pausedAt: true, invisibleMode: true, visibility: true, blockContacts: true } },
      verification: { select: { status: true, submittedAt: true, decidedAt: true, rejectionReason: true, selfieStorageKey: true } },
      identities: { where: { releasedAt: null }, orderBy: { createdAt: "asc" }, select: { provider: true, email: true, emailVerified: true, providerUsername: true, displayName: true, lastLoginAt: true }, take: 1 },
      subscriptions: { orderBy: { currentPeriodEnd: "desc" }, take: 10, select: { id: true, status: true, provider: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { name: true } }, order: { select: { reference: true } } } },
      orders: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, reference: true, status: true, planName: true, amountMinor: true, currency: true, createdAt: true, submittedAt: true, decidedAt: true } },
      _count: { select: { sessions: true, reportsFiled: true, reportsReceived: true, blocksGiven: true, blocksReceived: true } },
    },
  });
  if (!u) throw new NotFoundError("User");
  const [entitlements, openReports, recentReports, audit] = await Promise.all([
    getEntitlements(db, u.id, now),
    db.report.count({ where: { targetUserId: u.id, status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    db.report.findMany({ where: { targetUserId: u.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, reason: true, status: true, createdAt: true } }),
    db.auditLog.findMany({ where: { targetType: "User", targetId: u.id }, orderBy: { createdAt: "desc" }, take: 20, include: { actor: { select: { profile: { select: { displayName: true } } } } } }),
  ]);
  const photos = { approved: 0, pending: 0, rejected: 0 };
  for (const p of u.profile?.photos ?? []) {
    if (p.moderation === "APPROVED") photos.approved += 1;
    else if (p.moderation === "PENDING") photos.pending += 1;
    else photos.rejected += 1;
  }
  const age = u.dateOfBirth ? Math.floor((now.getTime() - u.dateOfBirth.getTime()) / (365.25 * 86_400_000)) : null;
  return {
    account: { userId: u.id, handle: u.profile?.handle ?? null, displayName: u.profile?.displayName ?? null, status: u.status, role: u.role, onboardingStage: u.onboardingStage, onboardingCompletedAt: u.onboardingCompletedAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(), lastActiveAt: u.lastActiveAt?.toISOString() ?? null, deletedAt: u.deletedAt?.toISOString() ?? null, hasPhone: Boolean(u.phoneE164), ageYears: age, activeSessions: u._count.sessions },
    signIn: u.identities[0]
      ? {
          provider: u.identities[0].provider,
          account: u.identities[0].provider === "TELEGRAM" ? (u.identities[0].providerUsername ? `@${u.identities[0].providerUsername}` : u.identities[0].displayName) : u.identities[0].email,
          emailVerified: u.identities[0].provider === "EMAIL" ? u.identities[0].emailVerified : null,
          lastLoginAt: u.identities[0].lastLoginAt?.toISOString() ?? null,
        }
      : null,
    profile: u.profile ? { location: u.profile.location?.name ?? null, intent: u.profile.intent, photos, bioLength: u.profile.bio?.length ?? 0, interests: u.profile._count.interests, prompts: u.profile._count.prompts } : null,
    privacy: u.privacy ? { paused: Boolean(u.privacy.pausedAt), invisibleMode: u.privacy.invisibleMode, visibility: u.privacy.visibility, blockContacts: u.privacy.blockContacts } : null,
    verification: { status: u.verification?.status ?? "NONE", submittedAt: u.verification?.submittedAt?.toISOString() ?? null, decidedAt: u.verification?.decidedAt?.toISOString() ?? null, rejectionReason: u.verification?.rejectionReason ?? null, hasSelfie: Boolean(u.verification?.selfieStorageKey) },
    membership: {
      tier: entitlements.tier,
      periodEnd: entitlements.subscription?.currentPeriodEnd.toISOString() ?? null,
      overridden: entitlements.overridden,
      subscriptions: u.subscriptions.map((s) => ({ id: s.id, planName: s.plan.name, status: s.status, provider: s.provider, currentPeriodStart: s.currentPeriodStart.toISOString(), currentPeriodEnd: s.currentPeriodEnd.toISOString(), orderReference: s.order?.reference ?? null })),
    },
    orders: u.orders.map((o) => ({ id: o.id, reference: o.reference, status: o.status, planName: o.planName, amountLabel: formatMoney(o.amountMinor, o.currency), createdAt: o.createdAt.toISOString(), submittedAt: o.submittedAt?.toISOString() ?? null, decidedAt: o.decidedAt?.toISOString() ?? null })),
    safety: { reportsReceived: u._count.reportsReceived, openReportsReceived: openReports, reportsFiled: u._count.reportsFiled, blocksGiven: u._count.blocksGiven, blocksReceived: u._count.blocksReceived, recentReports: recentReports.map((r) => ({ id: r.id, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() })) },
    audit: audit.map((a) => ({ id: a.id, action: a.action, actor: a.actor?.profile?.displayName ?? (a.actorId ? "Unknown" : "System"), createdAt: a.createdAt.toISOString(), data: a.data ?? null })),
  };
}

export type AccountAction = "SUSPEND" | "UNSUSPEND" | "BAN";

/**
 * Suspend / unsuspend / ban. Reason required (audited). Rules: never yourself; moderators act on USER accounts
 * only, admins on USER and MODERATOR accounts (change an admin's role first); DELETED accounts are untouchable.
 */
export async function setAccountStatus(admin: AdminActor, userId: string, input: { action: AccountAction; reason: string }, deps: { db?: Db; now?: Date } = {}): Promise<{ userId: string; status: AccountStatus }> {
  assertPermission(admin, "users.moderate");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const action = input?.action;
  if (action !== "SUSPEND" && action !== "UNSUSPEND" && action !== "BAN") throw new ValidationError("Choose an action");
  const reason = String(input?.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 300 || /[<>]/.test(reason)) throw new ValidationError("Give a short reason (3–300 characters)");
  if (userId === admin.userId) throw new InvalidStateError("You can't change your own account status");

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, role: true, onboardingCompletedAt: true } });
    if (!target) throw new NotFoundError("User");
    if (target.status === "DELETED") throw new InvalidStateError("Deleted accounts can't be changed");
    if (target.role === "ADMIN" || (target.role === "MODERATOR" && admin.role !== "ADMIN")) throw new InvalidStateError("Change this person's role before acting on their account");

    let next: AccountStatus;
    if (action === "SUSPEND") {
      if (target.status !== "ACTIVE" && target.status !== "ONBOARDING") throw new InvalidStateError(`This account is ${target.status.toLowerCase()}`);
      next = "SUSPENDED";
    } else if (action === "UNSUSPEND") {
      if (target.status !== "SUSPENDED") throw new InvalidStateError("This account isn't suspended");
      next = target.onboardingCompletedAt ? "ACTIVE" : "ONBOARDING";
    } else {
      if (target.status === "BANNED") throw new InvalidStateError("This account is already banned");
      next = "BANNED";
    }
    await tx.user.update({ where: { id: target.id }, data: { status: next } });
    if (next === "SUSPENDED" || next === "BANNED") await tx.session.deleteMany({ where: { userId: target.id } });
    const auditAction = action === "SUSPEND" ? AUDIT_ACTIONS.userSuspended : action === "UNSUSPEND" ? AUDIT_ACTIONS.userUnsuspended : AUDIT_ACTIONS.userBanned;
    await writeAudit(tx, { actorId: admin.userId, action: auditAction, targetType: "User", targetId: target.id, data: { reason, before: { status: target.status }, after: { status: next } }, now });
    return { userId: target.id, status: next };
  });
}

export { GRANTING_SUBSCRIPTION_STATUSES };
