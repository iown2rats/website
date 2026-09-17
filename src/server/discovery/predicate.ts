/**
 * The single visibility predicate (docs/ARCHITECTURE.md §7, §12.6).
 * Every list that shows one user to another goes through these fragments, so privacy rules
 * (blocks, contact hashes, visibility, Invisible Mode) are enforced in SQL, not in components.
 *
 * Fragments assume the candidate is aliased `u` (User), `p` (Profile), `ps` (PrivacySettings)
 * and, where preferences are applied, `cp` (candidate DiscoveryPreferences) and `loc` (Location).
 */
import { Prisma } from "@/generated/prisma/client";
import { activePlusSql } from "@/server/entitlements";

export interface ViewerContext {
  userId: string;
  phoneHash: Uint8Array;
  gender: "WOMAN" | "MAN" | "UNSPECIFIED" | null;
  interestedIn: "WOMEN" | "MEN" | "EVERYONE";
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

/**
 * Base visibility: may viewer V see candidate U at all? Independent of V's filters.
 * Used by discovery, Likes You, like(), profile views.
 */
export function baseVisibleSql(viewerId: string, viewerPhoneHash: Uint8Array, now: Date): Prisma.Sql {
  return Prisma.sql`
    u.id <> ${viewerId}
    AND u.status = 'ACTIVE'
    AND u."onboardingCompletedAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Block" b
      WHERE (b."blockerId" = ${viewerId} AND b."blockedId" = u.id)
         OR (b."blockerId" = u.id AND b."blockedId" = ${viewerId})
    )
    AND NOT EXISTS (
      SELECT 1 FROM "ContactHash" ch
      JOIN "PrivacySettings" ops ON ops."userId" = ch."userId" AND ops."blockContacts" = true
      WHERE (ch."userId" = u.id AND ch.hash = ${Buffer.from(viewerPhoneHash)})
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

/** Discovery-only: the candidate must be open to being discovered right now. */
export function discoverableSql(): Prisma.Sql {
  return Prisma.sql`ps.visibility = 'EVERYONE' AND ps."pausedAt" IS NULL`;
}

/** Mutual gender preference and the viewer's basic filters. */
export function preferenceSql(v: ViewerContext, now: Date): Prisma.Sql {
  const viewerGender = v.gender ?? "UNSPECIFIED";
  const parts: Prisma.Sql[] = [
    // Viewer wants candidate's gender
    Prisma.sql`(
      ${v.interestedIn} = 'EVERYONE'
      OR (u.gender = 'WOMAN' AND ${v.interestedIn} = 'WOMEN')
      OR (u.gender = 'MAN' AND ${v.interestedIn} = 'MEN')
    )`,
    // Candidate wants viewer's gender
    Prisma.sql`(
      cp."interestedIn" = 'EVERYONE'
      OR (${viewerGender} = 'WOMAN' AND cp."interestedIn" = 'WOMEN')
      OR (${viewerGender} = 'MAN' AND cp."interestedIn" = 'MEN')
    )`,
    Prisma.sql`u."dateOfBirth" IS NOT NULL`,
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

  if (v.advancedFilters) {
    if (v.heightMinCm != null) parts.push(Prisma.sql`p."heightCm" >= ${v.heightMinCm}`);
    if (v.heightMaxCm != null) parts.push(Prisma.sql`p."heightCm" <= ${v.heightMaxCm}`);
    if (v.education) parts.push(Prisma.sql`p.education ILIKE ${"%" + v.education + "%"}`);
  }

  return Prisma.join(parts, " AND ");
}

/** Exclude candidates the viewer has already acted on. */
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
      WHERE m."userAId" = LEAST(${viewerId}, u.id) AND m."userBId" = GREATEST(${viewerId}, u.id)
    )
  `;
}

/** Ranking: active boost first, then verified, then recently active, then a per-viewer stable shuffle. */
export function orderSql(viewerId: string, now: Date): Prisma.Sql {
  return Prisma.sql`
    (EXISTS (SELECT 1 FROM "Boost" bo WHERE bo."userId" = u.id AND bo."startsAt" <= ${now} AND bo."endsAt" > ${now})) DESC,
    (COALESCE(ver.status::text, '') = 'VERIFIED') DESC,
    u."lastActiveAt" DESC NULLS LAST,
    md5(u.id || ${viewerId})
  `;
}
