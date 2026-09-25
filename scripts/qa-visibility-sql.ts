/**
 * The visibility matrix as ONE hand-written SQL statement: for every viewer in a cohort, which cohort members their
 * Discover deck would contain right now. Used by `scripts/qa-cohort.ts verify` to check a live cohort against
 * expectations, and by tests/integration/discovery-consistency.test.ts, which runs it next to the real deck query
 * (src/server/discovery/query.ts) on the same rows and fails if the two disagree on a single pair. That test is what
 * keeps this copy honest: every rule below is a rule of src/server/discovery/predicate.ts, restated.
 *
 * Plain SQL, no application imports, so it can be printed and pasted into the Supabase SQL editor as it is.
 *
 * `cohortCte` must define `cohort(id, handle)`. Only production's photo policy is modelled (APPROVED photos count).
 */
export function visibilityMatrixSql(cohortCte: string): string {
  return `${cohortCte}
, viewers AS (
  SELECT u.id vid, p.handle vh, u.gender vg, u."phoneHash" vph,
         date_part('year', age(now(), u."dateOfBirth"))::int va,
         cp."connectionIntent" vci, cp."interestedIn" vi, cp."ageMin" vmin, cp."ageMax" vmax, cp.intent vint,
         cp."locationScope" vscope, cp."locationId" vloc, vl."atollCode" vatoll
  FROM cohort c JOIN "User" u ON u.id = c.id
  JOIN "Profile" p ON p."userId" = u.id
  JOIN "PrivacySettings" ps ON ps."userId" = u.id
  JOIN "DiscoveryPreferences" cp ON cp."userId" = u.id
  LEFT JOIN "Location" vl ON vl.id = p."locationId"
), cands AS (
  SELECT u.id cid, p.handle ch, p.id pid, u.gender cg, u."phoneHash" cph, u."dateOfBirth" cdob,
         date_part('year', age(now(), u."dateOfBirth"))::int ca,
         u."accountType" cacct, u.status cstatus, u."deletedAt" cdel, u."onboardingCompletedAt" conb,
         ps.visibility cvis, ps."pausedAt" cpaused, ps."invisibleMode" cinv,
         cp."connectionIntent" cci, cp."interestedIn" ci, cp."ageMin" cmin, cp."ageMax" cmax,
         p.intent cintent, p."locationId" cloc, cl."atollCode" catoll, cl."isGreaterMale" cgm
  FROM cohort c JOIN "User" u ON u.id = c.id
  JOIN "Profile" p ON p."userId" = u.id
  JOIN "PrivacySettings" ps ON ps."userId" = u.id
  JOIN "DiscoveryPreferences" cp ON cp."userId" = u.id
  LEFT JOIN "Location" cl ON cl.id = p."locationId"
)
SELECT v.vh AS viewer,
       coalesce(string_agg(c.ch, ' ' ORDER BY c.ch), '(empty deck)') AS deck,
       count(c.ch) AS n
-- LEFT JOIN, so a viewer whose deck is empty still appears as a row. That is a result, not an absence.
FROM viewers v LEFT JOIN cands c ON c.cid <> v.vid
  -- base visibility: a live, onboarded member account
  AND c.cacct = 'MEMBER' AND c.cstatus = 'ACTIVE' AND c.cdel IS NULL AND c.conb IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Block" b WHERE (b."blockerId" = v.vid AND b."blockedId" = c.cid) OR (b."blockerId" = c.cid AND b."blockedId" = v.vid))
  AND NOT EXISTS (
    SELECT 1 FROM "ContactHash" h JOIN "PrivacySettings" ops ON ops."userId" = h."userId" AND ops."blockContacts" = true
    WHERE (h."userId" = c.cid AND h.hash = v.vph) OR (h."userId" = v.vid AND h.hash = c.cph)
  )
  -- Invisible Mode: hidden unless they hold Plus right now AND liked this viewer
  AND (c.cinv = false OR (
    (EXISTS (SELECT 1 FROM "Subscription" s WHERE s."userId" = c.cid AND s."currentPeriodEnd" > now() AND s.status IN ('ACTIVE','TRIALING','PAST_DUE','CANCELLED'))
     OR EXISTS (SELECT 1 FROM "EntitlementOverride" eo WHERE eo."userId" = c.cid AND eo.tier = 'PLUS' AND eo."startsAt" <= now() AND eo."endsAt" > now()))
    AND EXISTS (SELECT 1 FROM "Like" l WHERE l."fromUserId" = c.cid AND l."toUserId" = v.vid)))
  -- discoverable: open to discovery, enough approved photos
  AND c.cvis = 'EVERYONE' AND c.cpaused IS NULL
  AND (SELECT count(*) FROM "ProfilePhoto" ph WHERE ph."profileId" = c.pid AND ph.moderation = 'APPROVED') >= 2
  -- compatibility: same pool; the pool's gender rule; both ages inside the other's range
  AND c.cci = v.vci
  AND (CASE v.vci
         WHEN 'DATING' THEN (c.cg = 'WOMAN' AND v.vg = 'MAN') OR (c.cg = 'MAN' AND v.vg = 'WOMAN')
         ELSE (v.vi = 'EVERYONE' OR (c.cg = 'WOMAN' AND v.vi = 'WOMEN') OR (c.cg = 'MAN' AND v.vi = 'MEN'))
          AND (c.ci = 'EVERYONE' OR (v.vg = 'WOMAN' AND c.ci = 'WOMEN') OR (v.vg = 'MAN' AND c.ci = 'MEN'))
       END)
  AND c.cdob IS NOT NULL
  AND (v.va IS NULL OR v.va BETWEEN c.cmin AND c.cmax)
  -- the viewer's own filters
  AND c.ca BETWEEN v.vmin AND v.vmax
  AND (v.vci <> 'DATING' OR v.vint IS NULL OR c.cintent = v.vint)   -- "Looking for" is Dating-only
  AND (CASE v.vscope
         WHEN 'ANYWHERE' THEN true
         WHEN 'GREATER_MALE' THEN c.cgm IS true
         WHEN 'MY_ATOLL' THEN c.catoll = coalesce(v.vatoll, '')
         WHEN 'SPECIFIC' THEN c.cloc = coalesce(v.vloc, '')
           OR EXISTS (SELECT 1 FROM "Location" sl WHERE sl.id = v.vloc AND sl.kind = 'ATOLL' AND sl."atollCode" = c.catoll)
       END)
  -- not already acted on
  AND NOT EXISTS (SELECT 1 FROM "Like" l WHERE l."fromUserId" = v.vid AND l."toUserId" = c.cid)
  AND NOT EXISTS (SELECT 1 FROM "Pass" pa WHERE pa."fromUserId" = v.vid AND pa."toUserId" = c.cid AND pa."undoneAt" IS NULL AND pa."expiresAt" > now())
  AND NOT EXISTS (SELECT 1 FROM "Match" m WHERE (m."userAId" = v.vid AND m."userBId" = c.cid) OR (m."userAId" = c.cid AND m."userBId" = v.vid))
GROUP BY v.vh
ORDER BY v.vh;`;
}
