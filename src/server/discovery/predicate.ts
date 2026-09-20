/**
 * The single visibility predicate (docs/ARCHITECTURE.md §7, §12.6).
 * Every list that shows one user to another goes through these fragments, so privacy rules
 * (blocks, contact hashes, visibility, Invisible Mode, photo moderation) are enforced in SQL, not in components.
 *
 * Fragments assume the candidate is aliased `u` (User), `p` (Profile), `ps` (PrivacySettings)
 * and, where preferences are applied, `cp` (candidate DiscoveryPreferences), `loc` (Location) and `ver` (Verification).
 */
import { Prisma } from "@/generated/prisma/client";
import { DISCOVERY } from "@/config/product";
import { displayablePhotoStates } from "@/lib/photo-policy";
import { activePlusSql } from "@/server/entitlements";

/**
 * "Someone else's hidden-contacts list contains the viewer's number." Without a phone on file the viewer cannot be
 * matched this way (FALSE); their own list (the other branch) still applies.
 */
function contactMatchesViewerSql(viewerPhoneHash: Uint8Array | null): Prisma.Sql {
  return viewerPhoneHash ? Prisma.sql`ch.hash = ${Buffer.from(viewerPhoneHash)}` : Prisma.sql`FALSE`;
}

export interface ViewerContext {
  userId: string;
  /** Null when the viewer has not added a phone number: only their own hidden-contacts list applies then. */
  phoneHash: Uint8Array | null;
  gender: "WOMAN" | "MAN" | "UNSPECIFIED" | null;
  /** Viewer's own age, used for the candidate's age preference (mutual compatibility). */
  age: number | null;
  interestedIn: "WOMEN" | "MEN" | "EVERYONE";
  /** Dating and Friendship are separate pools; see `intentCompatibilitySql`. */
  connectionIntent: "DATING" | "FRIENDSHIP";
  ageMin: number;
  ageMax: number;
  intent: string | null;
  locationScope: "ANYWHERE" | "GREATER_MALE" | "MY_ATOLL" | "SPECIFIC";
  locationId: string | null;
  atollCode: string | null;
  advancedFilters: boolean;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  education: string | null;
}

/** `moderation IN (...)` per the central photo visibility policy (APPROVED only in production). */
export function displayableModerationSql(): Prisma.Sql {
  return Prisma.join(displayablePhotoStates().map((m) => Prisma.sql`${m}::"PhotoModeration"`));
}

/**
 * An operational account is never a dating candidate (docs/ARCHITECTURE.md §22.5).
 *
 * A STAFF account has no Profile, so the INNER JOIN in every candidate query already excludes it and this clause
 * should never be the thing that does the work. It is here precisely because "should never" is not a guarantee:
 * a stale row, a half-run migration, a future code path that creates a Profile by accident, or a malformed record
 * restored from a backup would each be enough. Stating the rule in the canonical predicate means a staff account
 * cannot surface even when something upstream is wrong.
 */
export function memberOnlySql(): Prisma.Sql {
  return Prisma.sql`u."accountType" = 'MEMBER'`;
}

/**
 * Base visibility: may viewer V see candidate U at all? Independent of V's filters.
 * Used by discovery, Likes You, like(), profile views.
 */
export function baseVisibleSql(viewerId: string, viewerPhoneHash: Uint8Array | null, now: Date): Prisma.Sql {
  return Prisma.sql`
    u.id <> ${viewerId}
    AND ${memberOnlySql()}
    AND u.status = 'ACTIVE'
    AND u."deletedAt" IS NULL
    AND u."onboardingCompletedAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Block" b
      WHERE (b."blockerId" = ${viewerId} AND b."blockedId" = u.id)
         OR (b."blockerId" = u.id AND b."blockedId" = ${viewerId})
    )
    AND NOT EXISTS (
      SELECT 1 FROM "ContactHash" ch
      JOIN "PrivacySettings" ops ON ops."userId" = ch."userId" AND ops."blockContacts" = true
      WHERE (ch."userId" = u.id AND ${contactMatchesViewerSql(viewerPhoneHash)})
         OR (ch."userId" = ${viewerId} AND ch.hash = u."phoneHash")
    )
    AND (
      ps."invisibleMode" = false
      OR (
        ${activePlusSql(Prisma.sql`u.id`, now)}
        AND EXISTS (SELECT 1 FROM "Like" il WHERE il."fromUserId" = u.id AND il."toUserId" = ${viewerId})
      )
    )
  `;
}

/**
 * Relationship-only visibility between the viewer and a user aliased `u` (User): no Block in either direction and
 * no contact-hash intersection where the owner has blockContacts on. Used by Community, where account state and
 * Invisible Mode (discovery rules) do not apply but blocks and contact blocking do.
 */
export function noBlockOrContactSql(viewerId: string, viewerPhoneHash: Uint8Array | null): Prisma.Sql {
  return Prisma.sql`
    ${memberOnlySql()}
    AND NOT EXISTS (
      SELECT 1 FROM "Block" b
      WHERE (b."blockerId" = ${viewerId} AND b."blockedId" = u.id)
         OR (b."blockerId" = u.id AND b."blockedId" = ${viewerId})
    )
    AND NOT EXISTS (
      SELECT 1 FROM "ContactHash" ch
      JOIN "PrivacySettings" ops ON ops."userId" = ch."userId" AND ops."blockContacts" = true
      WHERE (ch."userId" = u.id AND ${contactMatchesViewerSql(viewerPhoneHash)})
         OR (ch."userId" = ${viewerId} AND ch.hash = u."phoneHash")
    )
  `;
}

/** The candidate's own choice to be discovered: visible to everyone and not paused. Says nothing about photos. */
export function openToDiscoverySql(): Prisma.Sql {
  return Prisma.sql`ps.visibility = 'EVERYONE' AND ps."pausedAt" IS NULL`;
}

/** Enough photos in a state other users may see under the active policy (APPROVED only in production). */
export function enoughDisplayablePhotosSql(): Prisma.Sql {
  return Prisma.sql`(
    SELECT count(*) FROM "ProfilePhoto" ph
    WHERE ph."profileId" = p.id AND ph.moderation IN (${displayableModerationSql()})
  ) >= ${DISCOVERY.minDisplayablePhotos}`;
}

/**
 * The candidate uploaded enough photos but not enough of them are displayable yet: they are waiting on moderation,
 * not missing. Used only to count such candidates, never to show them — a profile in this state stays out of every
 * deck. Under a policy where PENDING is displayable this is always false, because the two counts coincide.
 */
export function awaitingPhotoReviewSql(): Prisma.Sql {
  return Prisma.sql`
    NOT (${enoughDisplayablePhotosSql()})
    AND (
      SELECT count(*) FROM "ProfilePhoto" ph
      WHERE ph."profileId" = p.id AND ph.moderation <> 'REJECTED'
    ) >= ${DISCOVERY.minDisplayablePhotos}
  `;
}

/** Discovery-only: the candidate must be open to being discovered right now and have enough displayable photos. */
export function discoverableSql(): Prisma.Sql {
  return Prisma.sql`${openToDiscoverySql()} AND ${enoughDisplayablePhotosSql()}`;
}

/**
 * Dating and Friendship are separate pools (docs/ARCHITECTURE.md §7.5). Somebody here to date is never shown
 * somebody here for friends, in either direction.
 *
 * One equality does both directions at once, because the clause compares each side's own intent rather than a
 * preference about the other's: if the viewer is DATING, only DATING candidates pass, and a DATING candidate
 * running the same query sees only DATING viewers. There is nothing to keep in step.
 *
 * It sits in `compatibilitySql` rather than `viewerFilterSql` deliberately. The viewer's filters are preferences
 * they may relax; this is not a preference. A Plus member cannot widen their way into the other pool, and a future
 * "show me everyone" filter cannot accidentally reach across it.
 */
export function intentCompatibilitySql(v: ViewerContext): Prisma.Sql {
  return Prisma.sql`cp."connectionIntent" = ${v.connectionIntent}::"ConnectionIntent"`;
}

/**
 * Gender compatibility, which is a different rule in each pool.
 *
 * DATING is strictly opposite gender, and that is expressed here as the rule itself rather than by comparing the
 * two stored `interestedIn` values. The stored value is derived from gender on every write, so for a row written
 * under the current policy the two formulations agree — but rows predating the policy exist, and a stale one must
 * not be able to widen anybody's deck. Stating the rule directly means it holds for every row, whatever is stored:
 * a man is shown women and a woman men, full stop, and "Prefer not to say" falls out of Dating discovery on both
 * sides because it satisfies neither branch. Nothing is rewritten to make this true.
 *
 * FRIENDSHIP is the reciprocal preference check, where `interestedIn` IS the member's own answer and both
 * directions must agree ("Prefer not to say" is only shown to people who chose Everyone, in both directions).
 */
export function genderCompatibilitySql(v: ViewerContext): Prisma.Sql {
  const viewerGender = v.gender ?? "UNSPECIFIED";
  if (v.connectionIntent === "DATING") {
    return Prisma.sql`(
      (u.gender = 'WOMAN' AND ${viewerGender} = 'MAN')
      OR (u.gender = 'MAN' AND ${viewerGender} = 'WOMAN')
    )`;
  }
  return Prisma.sql`(
      ${v.interestedIn} = 'EVERYONE'
      OR (u.gender = 'WOMAN' AND ${v.interestedIn} = 'WOMEN')
      OR (u.gender = 'MAN' AND ${v.interestedIn} = 'MEN')
    )
    AND (
      cp."interestedIn" = 'EVERYONE'
      OR (${viewerGender} = 'WOMAN' AND cp."interestedIn" = 'WOMEN')
      OR (${viewerGender} = 'MAN' AND cp."interestedIn" = 'MEN')
    )`;
}

/**
 * Mutual compatibility, independent of the viewer's optional filters (docs/ARCHITECTURE.md §7.1):
 *  - the viewer and the candidate must be here for the same thing (Dating or Friendship);
 *  - their genders must be compatible, by the rule that belongs to that pool (`genderCompatibilitySql`);
 *  - the candidate must have a date of birth, and the viewer's age must fall inside the candidate's age range.
 */
export function compatibilitySql(v: ViewerContext): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    intentCompatibilitySql(v),
    genderCompatibilitySql(v),
    Prisma.sql`u."dateOfBirth" IS NOT NULL`,
  ];
  if (v.age != null) parts.push(Prisma.sql`${v.age} BETWEEN cp."ageMin" AND cp."ageMax"`);
  return Prisma.join(parts, " AND ");
}

/** The viewer's own filters: age range, intent, location scope, and (Plus only) advanced filters. */
export function viewerFilterSql(v: ViewerContext, now: Date): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`date_part('year', age(${now}::timestamp, u."dateOfBirth"::timestamp)) BETWEEN ${v.ageMin} AND ${v.ageMax}`,
  ];
  if (v.intent) parts.push(Prisma.sql`p.intent = ${v.intent}::"RelationshipIntent"`);

  switch (v.locationScope) {
    case "GREATER_MALE":
      parts.push(Prisma.sql`loc."isGreaterMale" = true`);
      break;
    case "MY_ATOLL":
      parts.push(Prisma.sql`loc."atollCode" = ${v.atollCode ?? ""}`);
      break;
    case "SPECIFIC":
      parts.push(Prisma.sql`p."locationId" = ${v.locationId ?? ""}`);
      break;
    case "ANYWHERE":
      break;
  }

  // Advanced filters are applied only when the viewer holds the entitlement; the stored values are otherwise inert.
  if (v.advancedFilters) {
    if (v.heightMinCm != null) parts.push(Prisma.sql`p."heightCm" >= ${v.heightMinCm}`);
    if (v.heightMaxCm != null) parts.push(Prisma.sql`p."heightCm" <= ${v.heightMaxCm}`);
    if (v.education) parts.push(Prisma.sql`p.education ILIKE ${"%" + v.education + "%"}`);
  }

  return Prisma.join(parts, " AND ");
}

/** Backwards-compatible alias: compatibility plus the viewer's filters. */
export function preferenceSql(v: ViewerContext, now: Date): Prisma.Sql {
  return Prisma.sql`${compatibilitySql(v)} AND ${viewerFilterSql(v, now)}`;
}

/** Exclude candidates the viewer has already acted on (like, unexpired pass, any match row). */
export function notSwipedSql(viewerId: string, now: Date): Prisma.Sql {
  return Prisma.sql`
    NOT EXISTS (SELECT 1 FROM "Like" l WHERE l."fromUserId" = ${viewerId} AND l."toUserId" = u.id)
    AND NOT EXISTS (
      SELECT 1 FROM "Pass" pa
      WHERE pa."fromUserId" = ${viewerId} AND pa."toUserId" = u.id
        AND pa."undoneAt" IS NULL AND pa."expiresAt" > ${now}
    )
    AND NOT EXISTS (
      SELECT 1 FROM "Match" m
      WHERE (m."userAId" = ${viewerId} AND m."userBId" = u.id)
         OR (m."userAId" = u.id AND m."userBId" = ${viewerId})
    )
  `;
}

/**
 * Ranking (docs/ARCHITECTURE.md §7.3): active boost, then verified, then most recently active, then a per-viewer
 * stable shuffle, then id. Every key is deterministic for a given (viewer, now), so adjacent batches agree.
 * Boosted profiles cannot starve others: once swiped they leave the deck (notSwipedSql), and a batch is bounded.
 */
export function orderSql(viewerId: string, now: Date): Prisma.Sql {
  return Prisma.sql`
    (EXISTS (SELECT 1 FROM "Boost" bo WHERE bo."userId" = u.id AND bo."startsAt" <= ${now} AND bo."endsAt" > ${now})) DESC,
    (COALESCE(ver.status::text, '') = 'VERIFIED') DESC,
    u."lastActiveAt" DESC NULLS LAST,
    md5(u.id || ${viewerId}),
    u.id
  `;
}
