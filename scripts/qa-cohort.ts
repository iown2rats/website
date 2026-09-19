/**
 * QA cohort — 20 clearly-marked test accounts for pre-launch testing of discovery, likes, matching, messaging,
 * filters and empty states. Plan and rationale: docs/DEPLOYMENT.md §11.
 *
 *   npx tsx scripts/qa-cohort.ts create        > create.sql
 *   npx tsx scripts/qa-cohort.ts verify        > verify.sql
 *   npx tsx scripts/qa-cohort.ts destroy-check > check.sql     (read-only: what WOULD be deleted, and who else it touches)
 *   npx tsx scripts/qa-cohort.ts destroy       > destroy.sql
 *
 * The commands print SQL rather than executing it, so the statements can be read before they run and applied
 * through whichever channel is appropriate (Supabase SQL editor, psql, or an MCP tool). Nothing here touches the
 * application: no schema change, no product code path, no relaxed authorization. The accounts are ordinary EMAIL
 * identities with real scrypt password hashes and go through the same rules as anybody else.
 *
 * THE THREE MARKERS. Every account carries all three, and `destroy` requires all three to match before it deletes
 * anything, so a real member cannot be caught by it:
 *   1. identity email  qa01@qa.mellocrush.invalid … (.invalid is reserved by RFC 2606 — unroutable, so a stray
 *      password-reset can never reach a person and can never bounce against the sending domain)
 *   2. Profile.handle  qa-01 … qa-20
 *   3. displayName     "… (TEST)"
 *
 * Photos are `demo/` placeholder keys, which the app renders as gradients (src/lib/photos.ts). No objects are put
 * in storage, and no photograph of any real person is involved.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/server/auth/password";

const GUARD = "MELLOCRUSH_QA_COHORT";
if (process.env[GUARD] !== "i-understand") {
  console.error(`Refusing to run. Set ${GUARD}=i-understand to generate cohort SQL.`);
  process.exit(1);
}

const EMAIL_DOMAIN = "qa.mellocrush.invalid";
const HANDLE_PREFIX = "qa-";
const NAME_SUFFIX = " (TEST)";
const BLURHASH = "LKO2?U%2Tw=w]~RBVZRi};RPxuwH";

type Gender = "WOMAN" | "MAN";
type InterestedIn = "WOMEN" | "MEN" | "EVERYONE";
type Intent = "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT";
type Scope = "ANYWHERE" | "GREATER_MALE" | "MY_ATOLL" | "SPECIFIC";

interface Person {
  n: number;
  name: string;
  gender: Gender;
  age: number;
  /** Location slug; must exist in the Location table. */
  island: string;
  interestedIn: InterestedIn;
  ageMin: number;
  ageMax: number;
  intent: Intent;
  scope: Scope;
  /** Only for scope SPECIFIC. */
  scopeIsland?: string;
  occupation: string;
  photos: number;
  /** qa-19 only: photos stay PENDING so the moderation queue has a permanent subject. */
  pending?: boolean;
  /** qa-17 only: needs an entitlement override, since Invisible Mode is a Plus feature. */
  invisible?: boolean;
  /** qa-18 only: Pause Dating. */
  paused?: boolean;
}

export const COHORT: Person[] = [
  { n: 1, name: "Aishath", gender: "WOMAN", age: 27, island: "male", interestedIn: "MEN", ageMin: 24, ageMax: 35, intent: "DATING", scope: "ANYWHERE", occupation: "Marketing Executive", photos: 3 },
  { n: 2, name: "Hassan", gender: "MAN", age: 29, island: "male", interestedIn: "WOMEN", ageMin: 24, ageMax: 33, intent: "DATING", scope: "ANYWHERE", occupation: "Software Engineer", photos: 3 },
  { n: 3, name: "Mariyam", gender: "WOMAN", age: 31, island: "hulhumale", interestedIn: "MEN", ageMin: 27, ageMax: 38, intent: "SERIOUS_RELATIONSHIP", scope: "ANYWHERE", occupation: "Architect", photos: 2 },
  { n: 4, name: "Ibrahim", gender: "MAN", age: 33, island: "hulhumale", interestedIn: "WOMEN", ageMin: 26, ageMax: 35, intent: "SERIOUS_RELATIONSHIP", scope: "ANYWHERE", occupation: "Dive Instructor", photos: 4 },
  { n: 5, name: "Fathimath", gender: "WOMAN", age: 25, island: "vilimale", interestedIn: "MEN", ageMin: 23, ageMax: 32, intent: "FIGURING_OUT", scope: "ANYWHERE", occupation: "Resort HR", photos: 2 },
  { n: 6, name: "Ahmed", gender: "MAN", age: 26, island: "vilimale", interestedIn: "WOMEN", ageMin: 22, ageMax: 30, intent: "FIGURING_OUT", scope: "ANYWHERE", occupation: "Graphic Designer", photos: 3 },
  { n: 7, name: "Nashfa", gender: "WOMAN", age: 19, island: "addu-city", interestedIn: "MEN", ageMin: 18, ageMax: 24, intent: "FIGURING_OUT", scope: "ANYWHERE", occupation: "Student", photos: 2 },
  { n: 8, name: "Yoosuf", gender: "MAN", age: 21, island: "addu-city", interestedIn: "WOMEN", ageMin: 18, ageMax: 26, intent: "FIGURING_OUT", scope: "ANYWHERE", occupation: "Barista", photos: 2 },
  { n: 9, name: "Hawwa", gender: "WOMAN", age: 44, island: "kulhudhuffushi", interestedIn: "MEN", ageMin: 38, ageMax: 50, intent: "MARRIAGE", scope: "ANYWHERE", occupation: "Head Teacher", photos: 2 },
  { n: 10, name: "Moosa", gender: "MAN", age: 45, island: "kulhudhuffushi", interestedIn: "WOMEN", ageMin: 38, ageMax: 48, intent: "MARRIAGE", scope: "ANYWHERE", occupation: "Boat Captain", photos: 3 },
  { n: 11, name: "Shifa", gender: "WOMAN", age: 35, island: "fuvahmulah", interestedIn: "EVERYONE", ageMin: 25, ageMax: 45, intent: "SERIOUS_RELATIONSHIP", scope: "ANYWHERE", occupation: "Nurse", photos: 3 },
  { n: 12, name: "Adam", gender: "MAN", age: 37, island: "thinadhoo", interestedIn: "WOMEN", ageMin: 30, ageMax: 42, intent: "SERIOUS_RELATIONSHIP", scope: "ANYWHERE", occupation: "Civil Engineer", photos: 2 },
  { n: 13, name: "Raufa", gender: "WOMAN", age: 23, island: "maafushi", interestedIn: "MEN", ageMin: 22, ageMax: 24, intent: "DATING", scope: "ANYWHERE", occupation: "Guesthouse Manager", photos: 2 },
  { n: 14, name: "Nizar", gender: "MAN", age: 30, island: "eydhafushi", interestedIn: "EVERYONE", ageMin: 18, ageMax: 45, intent: "DATING", scope: "ANYWHERE", occupation: "Photographer", photos: 4 },
  { n: 15, name: "Shan", gender: "MAN", age: 28, island: "naifaru", interestedIn: "WOMEN", ageMin: 24, ageMax: 34, intent: "DATING", scope: "MY_ATOLL", occupation: "Fisherman", photos: 2 },
  { n: 16, name: "Leena", gender: "WOMAN", age: 29, island: "male", interestedIn: "MEN", ageMin: 25, ageMax: 35, intent: "DATING", scope: "GREATER_MALE", occupation: "Pharmacist", photos: 3 },
  { n: 17, name: "Yaamin", gender: "MAN", age: 32, island: "male", interestedIn: "WOMEN", ageMin: 25, ageMax: 38, intent: "SERIOUS_RELATIONSHIP", scope: "ANYWHERE", occupation: "Pilot", photos: 3, invisible: true },
  { n: 18, name: "Sana", gender: "WOMAN", age: 30, island: "hulhumale", interestedIn: "MEN", ageMin: 26, ageMax: 36, intent: "SERIOUS_RELATIONSHIP", scope: "ANYWHERE", occupation: "Accountant", photos: 2, paused: true },
  { n: 19, name: "Rilwan", gender: "MAN", age: 34, island: "addu-city", interestedIn: "WOMEN", ageMin: 25, ageMax: 36, intent: "DATING", scope: "ANYWHERE", occupation: "Chef", photos: 2, pending: true },
  { n: 20, name: "Zulaikha", gender: "WOMAN", age: 40, island: "thinadhoo", interestedIn: "MEN", ageMin: 30, ageMax: 48, intent: "MARRIAGE", scope: "SPECIFIC", scopeIsland: "thinadhoo", occupation: "School Principal", photos: 2 },
];

/** Seeded swipe history, so the not-swiped branch has data from the first run. */
const PASSES: [number, number][] = [[1, 6], [3, 2], [16, 6]];
/** One blocked pair. They would otherwise be reciprocal, so the block is visible in the matrix. */
const BLOCK: [number, number] = [11, 14];

const pad = (n: number) => String(n).padStart(2, "0");
const handleOf = (p: Person) => `${HANDLE_PREFIX}${pad(p.n)}`;
const emailOf = (p: Person) => `qa${pad(p.n)}@${EMAIL_DOMAIN}`;
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const qn = (v: string | null | undefined) => (v == null ? "NULL" : q(v));

/** 24-character lowercase id in the same shape as the cuid(2) values Prisma generates. */
function makeId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(24);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Birth date that yields exactly `age` today, well away from a birthday boundary. */
function dobFor(age: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 60);
  return d.toISOString().slice(0, 10);
}

async function create(): Promise<string> {
  const now = new Date();
  const password = process.env.QA_COHORT_PASSWORD ?? randomBytes(12).toString("base64url");
  const hash = await hashPassword(password);

  /*
   * Emitted set-based rather than as 200 individual INSERTs: one VALUES list holds the cohort, and every table is
   * filled by selecting from it. Short enough to read in one screen, and the spec appears exactly once, so the
   * matrix in this file is demonstrably the matrix that reaches the database.
   *
   * Ids are 24-character lowercase strings, the same shape Prisma's cuid(2) produces. Nothing depends on their
   * format beyond uniqueness.
   */
  const rows = COHORT.map((p) => {
    const f = [
      p.n,
      q(p.name + NAME_SUFFIX),
      q(p.gender),
      p.age,
      q(p.island),
      q(p.interestedIn),
      p.ageMin,
      p.ageMax,
      q(p.intent),
      q(p.scope),
      qn(p.scopeIsland),
      q(p.occupation),
      p.photos,
      p.pending ? "true" : "false",
      p.invisible ? "true" : "false",
      p.paused ? "true" : "false",
    ];
    return `  (${f.join(", ")})`;
  });

  return `-- QA cohort: ${COHORT.length} marked test accounts. Generated by scripts/qa-cohort.ts.
-- Shared sign-in password for every account: ${password}
BEGIN;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Profile" WHERE handle LIKE '${HANDLE_PREFIX}%') THEN
  RAISE EXCEPTION 'QA cohort already present'; END IF; END $$;

CREATE TEMP TABLE qa_spec ON COMMIT DROP AS
SELECT * FROM (VALUES
${rows.join(",\n")}
) AS t(n, display_name, gender, age, island, interested, amin, amax, intent, scope, scope_island, occupation, photos, pending, invisible, paused);

-- One id per account, fixed for the rest of the transaction.
CREATE TEMP TABLE qa_new ON COMMIT DROP AS
SELECT s.*,
       ${q(HANDLE_PREFIX)} || lpad(s.n::text, 2, '0')                              AS handle,
       'qa' || lpad(s.n::text, 2, '0') || '@${EMAIL_DOMAIN}'                        AS email,
       'u' || lpad(s.n::text, 2, '0') || substr(md5(random()::text), 1, 21)         AS user_id,
       'p' || lpad(s.n::text, 2, '0') || substr(md5(random()::text), 1, 21)         AS profile_id,
       (now() - (s.age || ' years')::interval - interval '60 days')::date           AS dob
FROM qa_spec s;

INSERT INTO "User" (id, "dateOfBirth", gender, role, status, "onboardingStage", "onboardingCompletedAt", "lastActiveAt", "createdAt", "updatedAt")
SELECT user_id, dob, gender::"Gender", 'USER', 'ACTIVE', 'COMPLETE', now(), now(), now(), now() FROM qa_new;

INSERT INTO "Profile" (id, "userId", handle, "displayName", bio, occupation, languages, intent, "locationId", "createdAt", "updatedAt")
SELECT n.profile_id, n.user_id, n.handle, n.display_name,
       'Test account ' || n.handle || '. Not a real person.', n.occupation, ARRAY['Dhivehi','English'],
       n.intent::"RelationshipIntent", l.id, now(), now()
FROM qa_new n JOIN "Location" l ON l.slug = n.island;

INSERT INTO "PrivacySettings" ("userId", visibility, "invisibleMode", "pausedAt", "updatedAt")
SELECT user_id, 'EVERYONE', invisible, CASE WHEN paused THEN now() END, now() FROM qa_new;

INSERT INTO "DiscoveryPreferences" ("userId", "interestedIn", "ageMin", "ageMax", "locationScope", "locationId", "updatedAt")
SELECT n.user_id, n.interested::"InterestedIn", n.amin, n.amax, n.scope::"LocationScope", sl.id, now()
FROM qa_new n LEFT JOIN "Location" sl ON sl.slug = n.scope_island;

INSERT INTO "NotificationSettings" ("userId", "updatedAt") SELECT user_id, now() FROM qa_new;
INSERT INTO "Verification" ("userId", status, "updatedAt") SELECT user_id, 'NONE', now() FROM qa_new;

INSERT INTO "AuthIdentity" (id, "userId", provider, "providerSubject", email, "emailVerified", "displayName", "passwordHash", "passwordUpdatedAt", "createdAt")
SELECT 'i' || lpad(n::text, 2, '0') || substr(md5(random()::text), 1, 21), user_id, 'EMAIL', email, email, true, display_name,
       ${q(hash)}, now(), now()
FROM qa_new;

-- 2-4 placeholder photos each. demo/ keys render as gradients, so nothing is stored and nothing needs cleaning up.
INSERT INTO "ProfilePhoto" (id, "profileId", position, "storageKey", "thumbKey", blurhash, width, height, moderation, "createdAt")
SELECT 'f' || lpad(n.n::text, 2, '0') || i || substr(md5(random()::text), 1, 20), n.profile_id, i,
       'demo/' || n.handle || '/' || i || '.hue-' || (165 + (n.n * 7 + i * 13) % 50),
       'demo/' || n.handle || '/' || i || '-thumb.hue-' || (165 + (n.n * 7 + i * 13) % 50),
       ${q(BLURHASH)}, 1080, 1440,
       (CASE WHEN n.pending THEN 'PENDING' ELSE 'APPROVED' END)::"PhotoModeration", now()
FROM qa_new n, generate_series(0, n.photos - 1) AS i;

-- Invisible Mode is a Plus feature, so qa-17 needs the entitlement. An admin override is the legitimate way to hold
-- it for a test account — never a fabricated payment. It cascades away with the user.
INSERT INTO "EntitlementOverride" (id, "userId", tier, "startsAt", "endsAt", reason, "createdAt")
SELECT 'e' || lpad(n::text, 2, '0') || substr(md5(random()::text), 1, 21), user_id, 'PLUS', now(), now() + interval '180 days',
       'QA cohort: Invisible Mode test account', now()
FROM qa_new WHERE invisible;

-- Seeded swipe history and the blocked pair.
INSERT INTO "Pass" (id, "fromUserId", "toUserId", "createdAt", "expiresAt")
SELECT 's' || a.n || '-' || b.n || substr(md5(random()::text), 1, 18), a.user_id, b.user_id, now(), now() + interval '30 days'
FROM qa_new a JOIN qa_new b ON (a.n, b.n) IN (${PASSES.map(([x, y]) => `(${x}, ${y})`).join(", ")});

INSERT INTO "Block" (id, "blockerId", "blockedId", source, "createdAt")
SELECT 'b' || a.n || '-' || b.n || substr(md5(random()::text), 1, 18), a.user_id, b.user_id, 'MANUAL', now()
FROM qa_new a JOIN qa_new b ON a.n = ${BLOCK[0]} AND b.n = ${BLOCK[1]};

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM "Profile" WHERE handle LIKE '${HANDLE_PREFIX}%';
  IF n <> ${COHORT.length} THEN RAISE EXCEPTION 'expected ${COHORT.length} cohort profiles, found %', n; END IF;
END $$;
COMMIT;`;
}

/** The cohort, resolved by all three markers at once. Used by verify and destroy alike. */
const COHORT_CTE = `
WITH cohort AS (
  SELECT u.id, p.handle
  FROM "User" u
  JOIN "Profile" p ON p."userId" = u.id
  WHERE p.handle LIKE '${HANDLE_PREFIX}%'
    AND p."displayName" LIKE '%${NAME_SUFFIX.trim()}'
    AND EXISTS (SELECT 1 FROM "AuthIdentity" i WHERE i."userId" = u.id AND i.provider = 'EMAIL' AND i.email LIKE '%@${EMAIL_DOMAIN}')
)`;

/** The full visibility matrix, exactly as the discovery predicate computes it. */
function verify(): string {
  return `${COHORT_CTE}
, viewers AS (
  SELECT u.id vid, p.handle vh, u.gender vg, u."phoneHash" vph,
         date_part('year', age(now(), u."dateOfBirth"))::int va,
         cp."interestedIn" vi, cp."ageMin" vmin, cp."ageMax" vmax, cp.intent vint,
         cp."locationScope" vscope, cp."locationId" vloc, vl."atollCode" vatoll
  FROM cohort c JOIN "User" u ON u.id = c.id
  JOIN "Profile" p ON p."userId" = u.id
  JOIN "PrivacySettings" ps ON ps."userId" = u.id
  JOIN "DiscoveryPreferences" cp ON cp."userId" = u.id
  LEFT JOIN "Location" vl ON vl.id = p."locationId"
), cands AS (
  SELECT u.id cid, p.handle ch, p.id pid, u.gender cg,
         date_part('year', age(now(), u."dateOfBirth"))::int ca,
         u.status cstatus, u."onboardingCompletedAt" conb,
         ps.visibility cvis, ps."pausedAt" cpaused, ps."invisibleMode" cinv,
         cp."interestedIn" ci, cp."ageMin" cmin, cp."ageMax" cmax,
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
-- LEFT JOIN, so a viewer whose deck is empty still appears as a row. That is a result, not an absence:
-- qa-13 (22-24 band) and qa-15 (My atoll, Lh) are supposed to see nobody.
FROM viewers v LEFT JOIN cands c ON c.cid <> v.vid
  AND c.cstatus = 'ACTIVE' AND c.conb IS NOT NULL
  AND c.cvis = 'EVERYONE' AND c.cpaused IS NULL
  AND (c.cinv = false OR EXISTS (SELECT 1 FROM "Like" l WHERE l."fromUserId" = c.cid AND l."toUserId" = v.vid))
  AND (SELECT count(*) FROM "ProfilePhoto" ph WHERE ph."profileId" = c.pid AND ph.moderation = 'APPROVED') >= 2
  AND NOT EXISTS (SELECT 1 FROM "Block" b WHERE (b."blockerId" = v.vid AND b."blockedId" = c.cid) OR (b."blockerId" = c.cid AND b."blockedId" = v.vid))
  AND (v.vi = 'EVERYONE' OR (c.cg = 'WOMAN' AND v.vi = 'WOMEN') OR (c.cg = 'MAN' AND v.vi = 'MEN'))
  AND (c.ci = 'EVERYONE' OR (v.vg = 'WOMAN' AND c.ci = 'WOMEN') OR (v.vg = 'MAN' AND c.ci = 'MEN'))
  AND v.va BETWEEN c.cmin AND c.cmax
  AND c.ca BETWEEN v.vmin AND v.vmax
  AND (v.vint IS NULL OR c.cintent = v.vint)
  AND (CASE v.vscope
         WHEN 'ANYWHERE' THEN true
         WHEN 'GREATER_MALE' THEN c.cgm IS true
         WHEN 'MY_ATOLL' THEN c.catoll = coalesce(v.vatoll, '')
         WHEN 'SPECIFIC' THEN c.cloc = coalesce(v.vloc, '')
       END)
  AND NOT EXISTS (SELECT 1 FROM "Like" l WHERE l."fromUserId" = v.vid AND l."toUserId" = c.cid)
  AND NOT EXISTS (SELECT 1 FROM "Pass" pa WHERE pa."fromUserId" = v.vid AND pa."toUserId" = c.cid AND pa."undoneAt" IS NULL AND pa."expiresAt" > now())
  AND NOT EXISTS (SELECT 1 FROM "Match" m WHERE (m."userAId" = v.vid AND m."userBId" = c.cid) OR (m."userAId" = c.cid AND m."userBId" = v.vid))
GROUP BY v.vh
ORDER BY v.vh;`;
}

/**
 * Read-only. Prints the resolved cohort, everything a purge would delete, and — separately — every account
 * OUTSIDE the cohort whose rows would be destroyed along with it, because a like, match or conversation belongs
 * to both people in it. Read that list before running `destroy`.
 */
function destroyCheck(): string {
  return `${COHORT_CTE}
SELECT 'cohort' AS kind, handle AS detail, count(*) OVER () AS n FROM cohort
UNION ALL SELECT 'likes', '', count(*) FROM "Like" l WHERE l."fromUserId" IN (SELECT id FROM cohort) OR l."toUserId" IN (SELECT id FROM cohort)
UNION ALL SELECT 'passes', '', count(*) FROM "Pass" pa WHERE pa."fromUserId" IN (SELECT id FROM cohort) OR pa."toUserId" IN (SELECT id FROM cohort)
UNION ALL SELECT 'matches', '', count(*) FROM "Match" m WHERE m."userAId" IN (SELECT id FROM cohort) OR m."userBId" IN (SELECT id FROM cohort)
UNION ALL SELECT 'conversations', '', count(*) FROM "Conversation" c WHERE c."userAId" IN (SELECT id FROM cohort) OR c."userBId" IN (SELECT id FROM cohort)
UNION ALL SELECT 'messages', '', count(*) FROM "Message" ms WHERE ms."conversationId" IN (SELECT id FROM "Conversation" WHERE "userAId" IN (SELECT id FROM cohort) OR "userBId" IN (SELECT id FROM cohort))
UNION ALL SELECT 'community posts', '', count(*) FROM "CommunityPost" cp WHERE cp."authorId" IN (SELECT id FROM cohort)
UNION ALL
  -- The important one: real accounts whose own rows disappear with the cohort.
  SELECT 'NON-COHORT USER AFFECTED', coalesce(p.handle, o.id), count(*)
  FROM (
    SELECT l."fromUserId" id FROM "Like" l WHERE l."toUserId" IN (SELECT id FROM cohort)
    UNION ALL SELECT l."toUserId" FROM "Like" l WHERE l."fromUserId" IN (SELECT id FROM cohort)
    UNION ALL SELECT m."userAId" FROM "Match" m WHERE m."userBId" IN (SELECT id FROM cohort)
    UNION ALL SELECT m."userBId" FROM "Match" m WHERE m."userAId" IN (SELECT id FROM cohort)
    UNION ALL SELECT c."userAId" FROM "Conversation" c WHERE c."userBId" IN (SELECT id FROM cohort)
    UNION ALL SELECT c."userBId" FROM "Conversation" c WHERE c."userAId" IN (SELECT id FROM cohort)
  ) o
  LEFT JOIN "Profile" p ON p."userId" = o.id
  WHERE o.id NOT IN (SELECT id FROM cohort)
  GROUP BY 2;`;
}

/**
 * Deletes the cohort in foreign-key order. Like, Pass, Match, Conversation, Message, Intro, CommunityPost and
 * CommunityComment all declare onDelete: Restrict on their user columns, so the User rows cannot go first.
 * Everything else (Profile and its photos, settings, identities, sessions, blocks, notifications, overrides)
 * cascades from User.
 */
function destroy(): string {
  return `BEGIN;
CREATE TEMP TABLE qa_ids ON COMMIT DROP AS ${COHORT_CTE} SELECT id FROM cohort;

-- Abort unless exactly ${COHORT.length} accounts resolve on all three markers at once. A DO block, not a CASE with a
-- division by zero: Postgres folds constant expressions at planning time, so the CASE aborts even when it should not.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM qa_ids;
  IF n <> ${COHORT.length} THEN RAISE EXCEPTION 'expected ${COHORT.length} cohort accounts on all three markers, found %', n; END IF;
END $$;

DELETE FROM "Message" WHERE "conversationId" IN (SELECT id FROM "Conversation" WHERE "userAId" IN (SELECT id FROM qa_ids) OR "userBId" IN (SELECT id FROM qa_ids));
DELETE FROM "Intro" WHERE "fromUserId" IN (SELECT id FROM qa_ids) OR "toUserId" IN (SELECT id FROM qa_ids);
DELETE FROM "Conversation" WHERE "userAId" IN (SELECT id FROM qa_ids) OR "userBId" IN (SELECT id FROM qa_ids);
DELETE FROM "Match" WHERE "userAId" IN (SELECT id FROM qa_ids) OR "userBId" IN (SELECT id FROM qa_ids);
DELETE FROM "Like" WHERE "fromUserId" IN (SELECT id FROM qa_ids) OR "toUserId" IN (SELECT id FROM qa_ids);
DELETE FROM "Pass" WHERE "fromUserId" IN (SELECT id FROM qa_ids) OR "toUserId" IN (SELECT id FROM qa_ids);
DELETE FROM "CommunityLike" WHERE "userId" IN (SELECT id FROM qa_ids) OR "postId" IN (SELECT id FROM "CommunityPost" WHERE "authorId" IN (SELECT id FROM qa_ids));
DELETE FROM "CommunityComment" WHERE "authorId" IN (SELECT id FROM qa_ids) OR "postId" IN (SELECT id FROM "CommunityPost" WHERE "authorId" IN (SELECT id FROM qa_ids));
DELETE FROM "CommunityPost" WHERE "authorId" IN (SELECT id FROM qa_ids);
DELETE FROM "Report" WHERE "reporterId" IN (SELECT id FROM qa_ids) OR "targetUserId" IN (SELECT id FROM qa_ids);
DELETE FROM "SubscriptionOrder" WHERE "userId" IN (SELECT id FROM qa_ids);
DELETE FROM "Subscription" WHERE "userId" IN (SELECT id FROM qa_ids);
DELETE FROM "User" WHERE id IN (SELECT id FROM qa_ids);

DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM "Profile" WHERE handle LIKE '${HANDLE_PREFIX}%'; IF n <> 0 THEN RAISE EXCEPTION 'cohort not fully removed: % left', n; END IF; END $$;
COMMIT;`;
}

const command = process.argv[2];
const run = async () => {
  switch (command) {
    case "create":
      return create();
    case "verify":
      return verify();
    case "destroy-check":
      return destroyCheck();
    case "destroy":
      return destroy();
    default:
      console.error("Usage: qa-cohort.ts create|verify|destroy-check|destroy");
      process.exit(1);
  }
};
run().then((sql) => console.log(sql));
