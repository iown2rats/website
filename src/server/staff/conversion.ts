/**
 * MEMBER → STAFF conversion (docs/ARCHITECTURE.md §22.3).
 *
 * Promoting somebody to staff is never a role change. A dating account carries a profile, photos, a place in the
 * discovery graph and a Community identity; leaving any of that behind would mean the same person is a member and
 * an operator at once, which is exactly the thing this design forbids. So conversion is its own explicit,
 * transactional, audited operation with three properties:
 *
 *  1. **It reports before it acts.** `inventoryMemberData` lists every member-domain row attached to an account and
 *     `planConversion` says what would be preserved, deleted, detached or migrated. The production script prints
 *     that plan and refuses to proceed without an explicit confirmation flag.
 *  2. **It refuses to destroy evidence or relationships.** Likes, matches, conversations, messages, intros, member
 *     reports, orders, subscriptions and boosts are *entanglements*: they involve another person, money or a safety
 *     record. If an account has any, conversion stops and names them rather than deleting them to make the foreign
 *     keys tidy. Only self-contained dating state is removed.
 *  3. **It is all-or-nothing.** Everything runs inside one transaction under the `admin:roles` advisory lock, so a
 *     half-migrated account cannot exist and a concurrent role change cannot interleave with it.
 *
 * What conversion removes is the account's own dating presence: the Profile (and, by cascade, its photos,
 * interests and prompts), discovery preferences, privacy settings, its own verification record, its passes, and
 * its dating attributes on User. What it preserves is everything operational or shared: the User row itself, the
 * sign-in identity, every audit entry, every admin decision the account made, and every Community post or comment
 * it wrote — those are soft-deleted (hidden from members) rather than removed, because other people's replies and
 * reactions hang off them.
 */
import type { Db, DbLike, Tx } from "@/lib/db";
import { InvalidStateError, NotFoundError } from "@/lib/errors";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { isStaffRole, type StaffRole } from "./rules";

/** Rows attached to an account that belong to the dating domain, counted for the pre-conversion report. */
export interface MemberDataInventory {
  profile: number;
  profilePhotos: number;
  profileInterests: number;
  profilePrompts: number;
  privacySettings: number;
  discoveryPreferences: number;
  notificationSettings: number;
  verification: number;
  passesGiven: number;
  passesReceived: number;
  communityPosts: number;
  communityComments: number;
  communityLikes: number;
  contactHashes: number;
  pushSubscriptions: number;
  usageCounters: number;
  notificationsReceived: number;
  blocksGiven: number;
  blocksReceived: number;
  // Entanglements: these involve another person, money or a safety record.
  likesGiven: number;
  likesReceived: number;
  matches: number;
  conversations: number;
  messagesSent: number;
  introsSent: number;
  introsReceived: number;
  reportsFiled: number;
  reportsReceived: number;
  subscriptions: number;
  orders: number;
  boosts: number;
  entitlementOverrides: number;
  // Operational history, always preserved. Listed so the report can show what survives.
  auditEntries: number;
  reportsResolved: number;
  verificationsReviewed: number;
  ordersDecided: number;
  receiptRerunsTriggered: number;
  sessions: number;
  identities: number;
}

/**
 * Counts every member-domain and operational row attached to `userId`. Read-only: safe to run against production
 * before deciding anything.
 */
export async function inventoryMemberData(db: DbLike, userId: string): Promise<MemberDataInventory> {
  const profile = await db.profile.findUnique({ where: { userId }, select: { id: true } });
  const profileId = profile?.id;
  const [
    profilePhotos, profileInterests, profilePrompts, privacySettings, discoveryPreferences, notificationSettings,
    verification, passesGiven, passesReceived, communityPosts, communityComments, communityLikes, contactHashes,
    pushSubscriptions, usageCounters, notificationsReceived, blocksGiven, blocksReceived, likesGiven, likesReceived,
    matchesA, matchesB, conversationsA, conversationsB, messagesSent, introsSent, introsReceived, reportsFiled,
    reportsReceived, subscriptions, orders, boosts, entitlementOverrides, auditEntries, reportsResolved,
    verificationsReviewed, ordersDecided, receiptRerunsTriggered, sessions, identities,
  ] = await Promise.all([
    profileId ? db.profilePhoto.count({ where: { profileId } }) : Promise.resolve(0),
    profileId ? db.profileInterest.count({ where: { profileId } }) : Promise.resolve(0),
    profileId ? db.profilePrompt.count({ where: { profileId } }) : Promise.resolve(0),
    db.privacySettings.count({ where: { userId } }),
    db.discoveryPreferences.count({ where: { userId } }),
    db.notificationSettings.count({ where: { userId } }),
    db.verification.count({ where: { userId } }),
    db.pass.count({ where: { fromUserId: userId } }),
    db.pass.count({ where: { toUserId: userId } }),
    db.communityPost.count({ where: { authorId: userId, deletedAt: null } }),
    db.communityComment.count({ where: { authorId: userId, deletedAt: null } }),
    db.communityLike.count({ where: { userId } }),
    db.contactHash.count({ where: { userId } }),
    db.pushSubscription.count({ where: { userId } }),
    db.usageCounter.count({ where: { userId } }),
    db.notification.count({ where: { userId } }),
    db.block.count({ where: { blockerId: userId } }),
    db.block.count({ where: { blockedId: userId } }),
    db.like.count({ where: { fromUserId: userId } }),
    db.like.count({ where: { toUserId: userId } }),
    db.match.count({ where: { userAId: userId } }),
    db.match.count({ where: { userBId: userId } }),
    db.conversation.count({ where: { userAId: userId } }),
    db.conversation.count({ where: { userBId: userId } }),
    db.message.count({ where: { senderId: userId } }),
    db.intro.count({ where: { fromUserId: userId } }),
    db.intro.count({ where: { toUserId: userId } }),
    db.report.count({ where: { reporterId: userId } }),
    db.report.count({ where: { targetUserId: userId } }),
    db.subscription.count({ where: { userId } }),
    db.subscriptionOrder.count({ where: { userId } }),
    db.boost.count({ where: { userId } }),
    db.entitlementOverride.count({ where: { userId } }),
    db.auditLog.count({ where: { actorId: userId } }),
    db.report.count({ where: { resolvedById: userId } }),
    db.verification.count({ where: { reviewedById: userId } }),
    db.subscriptionOrder.count({ where: { decidedById: userId } }),
    db.receiptVerification.count({ where: { triggeredById: userId } }),
    db.session.count({ where: { userId } }),
    db.authIdentity.count({ where: { userId } }),
  ]);
  return {
    profile: profile ? 1 : 0,
    profilePhotos, profileInterests, profilePrompts, privacySettings, discoveryPreferences, notificationSettings,
    verification, passesGiven, passesReceived, communityPosts, communityComments, communityLikes, contactHashes,
    pushSubscriptions, usageCounters, notificationsReceived, blocksGiven, blocksReceived, likesGiven, likesReceived,
    matches: matchesA + matchesB,
    conversations: conversationsA + conversationsB,
    messagesSent, introsSent, introsReceived, reportsFiled, reportsReceived, subscriptions, orders, boosts,
    entitlementOverrides, auditEntries, reportsResolved, verificationsReviewed, ordersDecided,
    receiptRerunsTriggered, sessions, identities,
  };
}

export type ConversionTreatment = "preserved" | "deleted" | "detached" | "anonymized" | "migrated" | "blocking";

export interface ConversionPlanLine {
  what: string;
  count: number;
  treatment: ConversionTreatment;
  why: string;
}

export interface ConversionPlan {
  lines: ConversionPlanLine[];
  /** Entanglements that must be resolved by hand first. Conversion refuses while this is non-empty. */
  blockers: ConversionPlanLine[];
  canProceed: boolean;
}

/**
 * Turns an inventory into the explicit preserve / delete / detach list. Pure, so the production script, the admin
 * UI and the tests all describe a conversion the same way.
 */
export function planConversion(inv: MemberDataInventory): ConversionPlan {
  const lines: ConversionPlanLine[] = ([
    { what: "User row", count: 1, treatment: "preserved", why: "The account keeps its id; every operational record still points at it." },
    { what: "Sign-in identities", count: inv.identities, treatment: "preserved", why: "Authentication history survives. Staff sign-in adds an EMAIL identity beside it." },
    { what: "Audit log entries written by this account", count: inv.auditEntries, treatment: "preserved", why: "Administrative history is evidence and is never rewritten." },
    { what: "Reports this account resolved", count: inv.reportsResolved, treatment: "preserved", why: "Moderation history." },
    { what: "Verifications this account reviewed", count: inv.verificationsReviewed, treatment: "preserved", why: "Moderation history." },
    { what: "Payment orders this account decided", count: inv.ordersDecided, treatment: "preserved", why: "Financial history." },
    { what: "Receipt re-runs this account triggered", count: inv.receiptRerunsTriggered, treatment: "preserved", why: "Financial history." },
    { what: "Notification settings", count: inv.notificationSettings, treatment: "preserved", why: "Not dating data; staff may receive operational notifications later." },
    { what: "Blocks involving this account", count: inv.blocksGiven + inv.blocksReceived, treatment: "preserved", why: "Safety records are never deleted, and a block still works if the other person stays a member." },
    { what: "Passes received from other members", count: inv.passesReceived, treatment: "preserved", why: "Another member's action; theirs to keep." },

    { what: "Profile", count: inv.profile, treatment: "deleted", why: "A staff account has no dating profile. Releases the handle." },
    { what: "Profile photos", count: inv.profilePhotos, treatment: "deleted", why: "Cascades with the profile. Stored objects are removed separately by the script." },
    { what: "Profile interests", count: inv.profileInterests, treatment: "deleted", why: "Cascades with the profile." },
    { what: "Profile prompts", count: inv.profilePrompts, treatment: "deleted", why: "Cascades with the profile." },
    { what: "Discovery preferences", count: inv.discoveryPreferences, treatment: "deleted", why: "Pure dating state." },
    { what: "Privacy settings", count: inv.privacySettings, treatment: "deleted", why: "Dating visibility state. Its absence also makes the discovery join impossible." },
    { what: "Own verification record", count: inv.verification, treatment: "deleted", why: "Member verification does not apply to staff. Removes the account from the verification queue." },
    { what: "Passes this account gave", count: inv.passesGiven, treatment: "deleted", why: "One-directional dating state, invisible to the other person, with no evidentiary value." },
    { what: "Community likes this account gave", count: inv.communityLikes, treatment: "deleted", why: "A staff account must not hold a Community reaction as a member." },
    { what: "Contact hashes", count: inv.contactHashes, treatment: "deleted", why: "Contact-blocking data belongs to the dating domain." },
    { what: "Push subscriptions", count: inv.pushSubscriptions, treatment: "deleted", why: "Member device registrations; staff re-register if operational push is ever added." },
    { what: "Usage counters", count: inv.usageCounters, treatment: "deleted", why: "Daily like and boost allowances mean nothing for staff." },
    { what: "Notifications received", count: inv.notificationsReceived, treatment: "deleted", why: "Member notification feed." },

    { what: "Community posts written by this account", count: inv.communityPosts, treatment: "anonymized", why: "Soft-deleted: hidden from every member view, rows kept so other people's comments and reactions survive." },
    { what: "Community comments written by this account", count: inv.communityComments, treatment: "anonymized", why: "Soft-deleted for the same reason." },

    { what: "Dating attributes on User (date of birth, gender, phone)", count: 1, treatment: "detached", why: "Cleared. They exist only to match members with each other." },
    { what: "Onboarding completion", count: 1, treatment: "detached", why: "Cleared, so the account is not an onboarded member and a future STAFF → MEMBER would start fresh onboarding." },
    { what: "Active sessions", count: inv.sessions, treatment: "detached", why: "All revoked. The account signs in again through the admin portal." },
  ] satisfies ConversionPlanLine[]).filter((l) => l.count > 0);

  const blockers: ConversionPlanLine[] = [
    { what: "Likes given", count: inv.likesGiven, treatment: "blocking" as const, why: "Another member may have been matched by this. Resolve by hand." },
    { what: "Likes received", count: inv.likesReceived, treatment: "blocking" as const, why: "Another member's action; deleting it would rewrite their history." },
    { what: "Matches", count: inv.matches, treatment: "blocking" as const, why: "A match is a relationship with another member." },
    { what: "Conversations", count: inv.conversations, treatment: "blocking" as const, why: "A conversation belongs to two people." },
    { what: "Messages sent", count: inv.messagesSent, treatment: "blocking" as const, why: "Another member received these." },
    { what: "Intros sent", count: inv.introsSent, treatment: "blocking" as const, why: "Another member received these." },
    { what: "Intros received", count: inv.introsReceived, treatment: "blocking" as const, why: "Another member sent these." },
    { what: "Reports filed as a member", count: inv.reportsFiled, treatment: "blocking" as const, why: "Safety evidence." },
    { what: "Reports received as a member", count: inv.reportsReceived, treatment: "blocking" as const, why: "Safety evidence about this person." },
    { what: "Subscriptions", count: inv.subscriptions, treatment: "blocking" as const, why: "Money. Cancel and settle before converting." },
    { what: "Plus orders", count: inv.orders, treatment: "blocking" as const, why: "Money. Settle before converting." },
    { what: "Boosts", count: inv.boosts, treatment: "blocking" as const, why: "A purchased entitlement." },
    { what: "Entitlement overrides", count: inv.entitlementOverrides, treatment: "blocking" as const, why: "A granted entitlement." },
  ].filter((l) => l.count > 0);

  return { lines, blockers, canProceed: blockers.length === 0 };
}

export interface ConvertOptions {
  /** The staff authority the account gets. */
  role: StaffRole;
  /** Who is doing this. Null for an operator running the CLI with database access. */
  actorId: string | null;
  now?: Date;
  /** How the conversion was reached, recorded in the audit entry. */
  via: "invite" | "admin" | "cli" | "bootstrap";
  /**
   * Convert even though entanglements exist. There is no UI for this and the CLI does not offer it; it exists so a
   * future, deliberately designed unwind step can reuse the rest of this function.
   */
  force?: boolean;
}

export interface ConversionResult {
  userId: string;
  before: { accountType: string; role: string };
  after: { accountType: string; role: string };
  removed: MemberDataInventory;
  /** Storage objects the caller must delete: profile photos and any verification selfie. */
  orphanedStorageKeys: string[];
}

/**
 * Converts one account to STAFF inside the caller's transaction. The caller is responsible for taking the
 * `admin:roles` advisory lock — `convertToStaff` asserts nothing about locking so it can be composed with the
 * grant-claim path, which already holds it.
 */
export async function convertToStaff(tx: Tx, userId: string, options: ConvertOptions): Promise<ConversionResult> {
  const now = options.now ?? new Date();
  if (!isStaffRole(options.role)) throw new InvalidStateError("A staff account must be ADMIN or MODERATOR");

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, accountType: true, role: true, status: true },
  });
  if (!user) throw new NotFoundError("User");
  if (user.status === "DELETED") throw new InvalidStateError("A deleted account can't become staff");

  const inventory = await inventoryMemberData(tx, userId);
  const plan = planConversion(inventory);
  if (!plan.canProceed && !options.force) {
    const named = plan.blockers.map((b) => `${b.what} (${b.count})`).join(", ");
    throw new InvalidStateError(`This account has dating history that must be handled first: ${named}. Nothing was changed.`);
  }

  // Collect storage keys before the rows that name them are removed.
  const profile = await tx.profile.findUnique({ where: { userId }, select: { id: true } });
  const photos = profile ? await tx.profilePhoto.findMany({ where: { profileId: profile.id }, select: { storageKey: true, thumbKey: true } }) : [];
  const ownVerification = await tx.verification.findUnique({ where: { userId }, select: { selfieStorageKey: true } });
  const orphanedStorageKeys = [
    ...photos.flatMap((p) => [p.storageKey, p.thumbKey].filter((k): k is string => Boolean(k))),
    ...(ownVerification?.selfieStorageKey ? [ownVerification.selfieStorageKey] : []),
  ];

  // Self-contained dating state: removed. Profile deletion cascades to photos, interests and prompts.
  await tx.communityLike.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.pass.deleteMany({ where: { fromUserId: userId } });
  await tx.usageCounter.deleteMany({ where: { userId } });
  await tx.contactHash.deleteMany({ where: { userId } });
  await tx.pushSubscription.deleteMany({ where: { userId } });
  await tx.verification.deleteMany({ where: { userId } });
  await tx.discoveryPreferences.deleteMany({ where: { userId } });
  await tx.privacySettings.deleteMany({ where: { userId } });
  if (profile) await tx.profile.delete({ where: { userId } });

  // Shared Community content: hidden from members, rows kept so other people's replies and reactions survive.
  await tx.communityPost.updateMany({ where: { authorId: userId, deletedAt: null }, data: { deletedAt: now } });
  await tx.communityComment.updateMany({ where: { authorId: userId, deletedAt: null }, data: { deletedAt: now } });

  const updated = await tx.user.update({
    where: { id: userId },
    data: {
      accountType: "STAFF",
      role: options.role,
      status: "ACTIVE",
      // No longer an onboarded member. Also means the discovery predicate's onboarding test excludes the account
      // even if a Profile were somehow recreated.
      onboardingCompletedAt: null,
      onboardingStage: "NAME",
      dateOfBirth: null,
      gender: null,
      phoneE164: null,
      phoneHash: null,
    },
    select: { id: true, accountType: true, role: true },
  });

  // Every existing session ends: the account signs in again through the admin portal.
  await tx.session.deleteMany({ where: { userId } });

  await writeAudit(tx, {
    actorId: options.actorId,
    action: AUDIT_ACTIONS.staffConverted,
    targetType: "User",
    targetId: userId,
    data: {
      via: options.via,
      before: { accountType: user.accountType, role: user.role },
      after: { accountType: updated.accountType, role: updated.role },
      removed: inventory as unknown as Record<string, number>,
      forced: options.force === true,
    },
    now,
  });

  return {
    userId,
    before: { accountType: user.accountType, role: user.role },
    after: { accountType: updated.accountType, role: updated.role },
    removed: inventory,
    orphanedStorageKeys,
  };
}

/**
 * Standalone conversion with its own transaction and the `admin:roles` lock. Used by the CLI and by the admin
 * bootstrap path; the invitation-claim path composes `convertToStaff` into its own transaction instead.
 */
export async function convertAccountToStaff(db: Db, userId: string, options: ConvertOptions): Promise<ConversionResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:roles'))`;
    return convertToStaff(tx, userId, options);
  });
}
