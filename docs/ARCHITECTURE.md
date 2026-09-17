# Thundi — Architecture (Phase 2)

Companion to `docs/PROTOTYPE_AUDIT.md`. This document fixes the technical shape of the production application before any code is written. Where a choice has a security consequence, the consequence is stated next to it.

## 1. Stack and versions

Versions below were checked against the npm registry on 2026-09-17 and are mutually compatible.

| Layer | Choice | Version | Notes |
| --- | --- | --- | --- |
| Framework | Next.js, App Router | 16.3 | Turbopack default. Request middleware lives in `proxy.ts` (the Next 16 name for the former `middleware.ts`). Request APIs (`cookies()`, `headers()`, `params`) are async. |
| UI runtime | React / React DOM | 19.3 | Server Components by default; client islands only where interaction needs them. |
| Language | TypeScript | 5.9 (pinned) | TypeScript 7 is `latest` but the ESLint/Next toolchain is validated on 5.x; revisit later. `strict`, `noUncheckedIndexedAccess`. |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` | 4.3 | Tokens are CSS custom properties in `src/styles/tokens.css`, exposed to Tailwind with `@theme`. No shadcn defaults. |
| Font | Plus Jakarta Sans via `next/font/google` | — | Weights 400/500/600/700/800, `display: swap`, self-hosted at build time so no runtime request to Google. |
| Database | PostgreSQL 17 (Supabase project `Thundi`, ap-south-1) | — | Project is currently empty (no tables). |
| ORM | Prisma ORM | 7.10 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`) | Prisma 7 requires a driver adapter and a `prisma.config.ts`; generator `prisma-client` with explicit `output`. Migrations via `prisma migrate`. |
| Validation | Zod | 4.6 | Every server action, route handler and form. Shared schemas in `src/lib/validation`. |
| Object storage | Supabase Storage | `@supabase/supabase-js` 2.x | Private buckets, server-signed upload and read URLs. |
| Realtime (later) | Supabase Realtime Broadcast | same SDK | Behind a `MessagingTransport` interface; polling fallback ships first. |
| Images | `next/image` + `sharp` | 0.35 | Server-side re-encode of uploads (EXIF stripped, resized variants). |
| Tests | Vitest 5, Playwright 1.63 | — | Unit and integration tests hit a real Postgres (local Docker or a Supabase branch), never mocks of Prisma. |
| Lint/format | ESLint 9 (`eslint-config-next` 16), Prettier | — | ESLint 10 breaks the React plugin bundled with `eslint-config-next`; stay on 9 until that is fixed upstream. |
| Runtime | Node 22 LTS | — | Required by Prisma 7 (>= 22.18). |

Not used: Supabase Auth (phone OTP needs our own state machine and rate limits), NextAuth (no OAuth), tRPC (server actions + a few route handlers suffice), any UI kit.

## 2. Repository layout

```
.
├─ prototype/                     unmodified design source (read-only reference)
├─ docs/                          audit, architecture, contact blocking, security notes
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  ├─ seed.ts                     dev/demo seed (refuses to run when NODE_ENV=production)
│  └─ seed-data/                  profiles, posts, locations, interests, prompts (from thundi-data.js)
├─ prisma.config.ts               Prisma 7 config: schema path, migrations, seed, datasource url
├─ proxy.ts                       session cookie presence check, auth/onboarding redirects, security headers
├─ src/
│  ├─ app/
│  │  ├─ (public)/                / welcome, /legal/*
│  │  ├─ (auth)/                  /login (phone), /login/verify (OTP)
│  │  ├─ (onboarding)/onboarding/[step]
│  │  ├─ (app)/                   authenticated shell: sidebar / bottom nav
│  │  │  ├─ discover/
│  │  │  ├─ likes/
│  │  │  ├─ chats/  chats/[conversationId]/
│  │  │  ├─ community/  community/[postId]/
│  │  │  ├─ profile/  profile/edit/  profile/preview/
│  │  │  ├─ settings/  settings/privacy/  settings/safety/  settings/verification/  settings/plus/
│  │  │  ├─ people/[handle]/      full profile overlay (intercepting route from discover/likes/chats/community)
│  │  │  └─ @overlay/             parallel route slot for full profile, match, sheets
│  │  ├─ api/                     route handlers only where a fetch endpoint is needed
│  │  │  ├─ uploads/sign/         signed upload ticket
│  │  │  ├─ webhooks/payments/    provider webhook (verifies signature)
│  │  │  └─ health/
│  │  ├─ layout.tsx  globals.css  not-found.tsx  error.tsx
│  ├─ components/
│  │  ├─ ui/                      primitives styled to tokens (Button, IconButton, Field, Select, Textarea,
│  │  │                            Chip, RadioCard, Toggle, Segmented, PillTabs, ListRow, ListGroup, Callout,
│  │  │                            OceanCard, Sheet, PageOverlay, Toast, Avatar, Badge, Tag, ProgressBar,
│  │  │                            CompletionRing, Skeleton, EmptyState, ErrorState)
│  │  ├─ layout/                  AppShell, BottomNav, Sidebar, RightAside, ScreenHeader
│  │  └─ features/
│  │     ├─ onboarding/           StepFrame, PhoneStep, OtpStep, DobStep, ... PrivacyStep, DoneStep
│  │     ├─ discovery/            Deck (client), ProfileCard, SwipeControls, LikePassStamps, FiltersSheet, EmptyDeck
│  │     ├─ profile/              FullProfile, PromptCard, InfoTable, InterestChips, PhotoGrid (client), EditTabs
│  │     ├─ likes/                LikesGrid, LikesYouBanner
│  │     ├─ chat/                 ConversationList, ConversationView (client), MessageBubble, Composer, IntroLockedFooter
│  │     ├─ intro/                IntroSheet
│  │     ├─ match/                MatchOverlay
│  │     ├─ community/            PostCard, PostList (infinite), ComposeSheet, CommentList
│  │     ├─ safety/               ReportSheet, BlockConfirm, SafetyCenter
│  │     ├─ plus/                 PlusHero, PerkList, PlanCards
│  │     └─ verification/         VerificationSteps, SelfieCapture
│  ├─ server/                     domain layer (no React, no Next imports except `cache`/`revalidate` helpers)
│  │  ├─ auth/                    otp.ts, session.ts, rate-limit.ts, phone.ts
│  │  ├─ users/                   account state, roles, deletion
│  │  ├─ profiles/                read models (visibleProfileSelect), edit, photos, completion
│  │  ├─ discovery/               deck query, filters, exclusions
│  │  ├─ likes/                   like, pass, likesYou, quotas
│  │  ├─ matching/                createMatchIfMutual (transaction)
│  │  ├─ conversations/           list, get, send, read state, authorization
│  │  ├─ intros/                  send intro, quota, unlock on match
│  │  ├─ community/               feed, post, comment, like, report hook
│  │  ├─ safety/                  block, unblock, report, unmatch
│  │  ├─ privacy/                 settings read/write, filter predicates
│  │  ├─ contacts/                contact hash upload and matching (see CONTACT_BLOCKING.md)
│  │  ├─ verification/            state machine + VerificationProvider
│  │  ├─ entitlements/            subscription → capability set, `can()`
│  │  ├─ notifications/           create, list, mark read, counts
│  │  └─ moderation/              report queue read models (admin role only)
│  ├─ lib/
│  │  ├─ db.ts                    PrismaClient singleton with pg adapter
│  │  ├─ env.ts                   Zod-validated process.env (server) and public env (client)
│  │  ├─ validation/              shared Zod schemas (phone, dob, profile, message, post, report...)
│  │  ├─ storage/                 StorageProvider interface + SupabaseStorage + LocalDiskStorage (dev)
│  │  ├─ sms/                     SmsProvider interface + ConsoleSms (dev) + provider stub
│  │  ├─ payments/                PaymentProvider interface + NotConfiguredProvider
│  │  ├─ realtime/                MessagingTransport interface + PollingTransport + SupabaseBroadcast (later)
│  │  ├─ age.ts  dates.ts  ids.ts  errors.ts  result.ts
│  ├─ actions/                    server actions grouped by feature; thin: session → Zod → server/* → revalidate
│  ├─ constants/                  islands, interests, prompts, intents, genders, report reasons, plans, perks, limits
│  ├─ types/                      shared DTO types (never Prisma models leaked to the client)
│  └─ styles/                     tokens.css, globals.css
├─ tests/
│  ├─ unit/                       age, phone, otp rules, entitlements, completion
│  ├─ integration/                db-backed: likes, matching, blocks, conversations, intros, privacy, reports
│  └─ e2e/                        Playwright: onboarding happy path, swipe via buttons, chat send
├─ .env.example
└─ package.json
```

Rules that keep this maintainable:

- Pages and layouts fetch through `src/server/*` read models and render. They never call Prisma directly.
- Server actions never contain business logic. They resolve the session, validate input, call one domain function, and revalidate.
- Domain functions receive an `Actor` (`{ userId, role, entitlements }`) as the first argument and never a user id from the client payload.
- Client components receive DTOs from `src/types`, never Prisma rows.
- One file per concept; a component over ~200 lines is split.

## 3. Rendering, routing and navigation model

- The authenticated shell `(app)/layout.tsx` renders `Sidebar` (≥ 900 px) or `BottomNav` (< 900 px) exactly as the prototype: five tabs, badges from `notifications`/`conversations` counts, glass nav that hides when a conversation or overlay is open.
- Tabs are real routes so refresh, back and deep links work. The full profile, match screen and sheets are rendered in the `@overlay` parallel slot via intercepting routes, so the underlying tab stays mounted and the URL is shareable (`/people/aishath` opens over whichever tab you were on).
- Bottom sheets (filters, report, intro, compose) are client components driven by URL search params or local state, whichever keeps the prototype behaviour; they are not separate pages.
- Discover is server-rendered with the first 10 deck profiles inlined; the `Deck` client island handles drag, keyboard and optimistic like/pass, and asks the server for the next page when 3 cards remain.
- Chats list is a server component; `ConversationView` is a client island that starts from server-rendered history and then uses the `MessagingTransport` (polling every few seconds initially, Realtime later).
- Community feed uses cursor pagination (20 posts per page) with infinite loading in a client wrapper.
- Caching: nothing user-specific is cached. Public reference data (islands, interests, prompts, plans) uses `"use cache"` with long revalidation. All authenticated pages are dynamic.
- Loading states: every route has `loading.tsx` with skeletons in the prototype's geometry. Every route has `error.tsx` using the empty-state pattern with a retry action. Offline: a small client hook shows a toast-style banner when `navigator.onLine` is false and disables sends.

## 4. Authentication and sessions

### 4.1 Phone + OTP

- Phone input accepts 7 digits, normalised to E.164 `+960XXXXXXX`. Validation rejects anything outside Maldivian mobile ranges (7xx xxxx and 9xx xxxx). Stored as `User.phoneE164` (unique) plus `phoneHash` (HMAC-SHA-256 with a server secret) for lookups without exposing the number in indexes that might be dumped.
- OTP: 6 digits from `crypto.randomInt`. Stored only as `sha256(code + otpRequestId + pepper)`. Expires in 5 minutes. Max 5 verify attempts per request, then the request is void. Resend cooldown 45 s; max 5 requests per phone per hour and 20 per IP per hour (Postgres-backed sliding window in `RateLimitBucket`; no Redis dependency).
- `SmsProvider` interface: `send(to, message)`. Implementations: `ConsoleSmsProvider` (dev; prints the code to the server log and, when `THUNDI_DEV_OTP_ECHO=true` and `NODE_ENV !== "production"`, returns it in the action result so the UI can auto-fill) and a provider stub for the chosen SMS gateway. In production the code path that echoes the OTP is compiled out by an `env.ts` refinement that throws at boot if `THUNDI_DEV_OTP_ECHO` is set.
- Enumeration: the request step responds identically whether or not the phone exists; account creation happens only after a successful verify.

### 4.2 Sessions

- Opaque 256-bit random token in an `HttpOnly; Secure; SameSite=Lax; Path=/` cookie named `thundi_session`. The database stores `sha256(token)`, user id, created/lastSeen/expires, user agent and IP prefix.
- Sliding expiry: 30 days idle, 90 days absolute. Logout deletes the row. "Log out everywhere" deletes all rows for the user.
- `proxy.ts` only checks for cookie presence and redirects unauthenticated requests away from `(app)` and `(onboarding)`; the actual session lookup happens in `getActor()` (server, `React.cache` per request) which also enforces account state: `ACTIVE` proceeds, `ONBOARDING` redirects to the next incomplete step, `PAUSED` proceeds with discovery disabled, `SUSPENDED`/`BANNED` are logged out with a message, `DELETED` is treated as absent.
- CSRF: server actions are same-origin by construction in Next; the few route handlers that mutate (upload signing, webhooks) check `Origin`/`Sec-Fetch-Site` or a provider signature respectively.
- Security headers set in `proxy.ts`: CSP (self, Supabase storage host for images, no inline scripts except Next's nonce), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera only on the verification route), `X-Content-Type-Options`, `frame-ancestors 'none'`.

### 4.3 Age gate

- DOB is collected once during onboarding, validated server-side (`age(dob) >= 18` computed in UTC), stored on `User.dateOfBirth`, and can only be changed by a moderator. Age is derived at read time and exposed as `age` on profile DTOs; DOB is never selected into any public DTO.
- Every write that would complete onboarding re-checks age. A user whose stored DOB implies under 18 (for example after a moderator correction) is set to `SUSPENDED` with reason `UNDERAGE`.

## 5. Database design principles

Full schema follows in Phase 3. The shape:

- `User` (account: phone, DOB, gender, role, status, timestamps) is separate from `Profile` (public-facing fields) which is separate from `PrivacySettings`, `DiscoveryPreferences` and `NotificationSettings`. This makes the "never expose" list a matter of which table you join.
- `ProfilePhoto` rows with `position` (0 = primary), storage key, width/height, blurhash, moderation status. Unique on `(profileId, position)`; reordering is a single transaction that renumbers.
- `Interest` and `Prompt` are reference tables seeded from the prototype lists; `ProfileInterest` (max 6) and `ProfilePrompt` (max 3, with answer) are join tables with unique constraints.
- `Location` reference table: atoll code, atoll name, island/city name, `isCity`, `isGreaterMale`. Profile references `locationId`. The prototype's flat list of 33 entries is the seed, structured so "My atoll" and "Greater Malé" filters are joins, not string matching.
- `Like` (`fromUserId`, `toUserId`, optional `introId`, `createdAt`) unique on the pair. `Pass` same shape with `expiresAt` so passed profiles can resurface after 30 days, plus `undoneAt` so an Undo is recorded rather than deleted. `Match` with `userAId < userBId` enforced in code and unique on `(userAId, userBId)`, `status` (`ACTIVE`, `UNMATCHED`, `BLOCKED`), `unmatchedById`.
- `UsageCounter` (`userId`, `kind` LIKES | BOOSTS, `windowStart`, `windowEnd`, `used`) with primary key `(userId, kind)`: one row per user per limited action, locked `FOR UPDATE` inside the consuming transaction. No per-event rows, no cron. `Boost` (`userId`, `startsAt`, `endsAt`) records each activation.
- `Conversation` 1:1 with `Match`; `ConversationParticipant` (userId, lastReadMessageId, mutedAt); `Message` (conversationId, senderId, body, `kind` TEXT/INTRO/SYSTEM, createdAt, deletedAt). Messages are never hard-deleted; unmatch flips the conversation to `LOCKED` and hides it from both lists, keeping evidence for moderation.
- `Intro` (fromUserId, toUserId, body ≤ 140, createdAt, `weekKey`) unique on `(fromUserId, weekKey)` for free users' quota (enforced in code as well since Plus users bypass it).
- `Block` (blockerId, blockedId, reason source) unique on the pair. `Report` (reporterId, target polymorphic: `targetUserId`, `targetPostId`, `targetMessageId`, `reason` enum, note, status, resolution). Reports keep pointers even if the target is later soft-deleted.
- `Verification` (userId, status `NONE/PHONE_VERIFIED/SELFIE_SUBMITTED/UNDER_REVIEW/VERIFIED/REJECTED`, selfieStorageKey, providerRef, reviewedById, decidedAt).
- `SubscriptionPlan` (code WEEKLY | MONTHLY | QUARTERLY, interval, price in minor units, currency, badge, `isPlaceholderPrice`) and `Subscription` (userId, planId, status ACTIVE | TRIALING | PAST_DUE | CANCELLED | EXPIRED, provider, providerCustomerRef, providerSubscriptionRef, startedAt, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd). Entitlements are computed from these rows at request time, never stored on the user, except `EntitlementOverride` (admin grants with an expiry). Card data is never stored.
- `CommunityPost`, `CommunityComment`, `CommunityLike` with soft delete and per-user unique like.
- `Notification` (userId, type enum, actorId, refs, readAt, createdAt) indexed on `(userId, readAt, createdAt)`.
- `ContactHash` (userId, hash, createdAt) unique on `(userId, hash)`; see CONTACT_BLOCKING.md.
- `OtpRequest`, `Session`, `RateLimitBucket`, `AuditLog` for the auth and security paths.

Conventions: `cuid2` ids; `createdAt`/`updatedAt` on every table; foreign keys with `onDelete: Cascade` only for pure children (photos, participants, settings), `Restrict` for anything that is moderation evidence; enums for all closed vocabularies; composite indexes for every hot query (deck exclusion, conversation list, notification count).

### Connection strategy on Supabase

- Runtime (Next server, serverless-friendly): Supavisor transaction pooler `aws-0-ap-south-1.pooler.supabase.com:6543` with `?pgbouncer=true` so Prisma disables prepared statements. `connection_limit` kept low (5) per instance.
- Migrations, seed, `prisma migrate diff`: session pooler on port 5432 (works from IPv4-only CI). Direct `db.<ref>.supabase.co:5432` is IPv6-only without the add-on.
- Two env vars: `DATABASE_URL` (pooled, runtime) and `DIRECT_DATABASE_URL` (session/direct, tooling). `prisma.config.ts` reads `DIRECT_DATABASE_URL`; `src/lib/db.ts` reads `DATABASE_URL` through the pg adapter.
- The app connects with a dedicated Postgres role (`thundi_app`) that owns only the `public` schema, not the Supabase `postgres` superuser. Row Level Security is not used for the app's own tables because access control lives in the domain layer with a single privileged connection; RLS remains enabled by default on any table Supabase clients could reach directly (none planned).

## 6. Storage and photos

- `StorageProvider` interface: `createUploadTicket(userId, kind, contentType, size)`, `finalizeUpload(key)`, `getSignedReadUrl(key, ttl)`, `delete(key)`. Implementations: `SupabaseStorageProvider` (private buckets `profile-photos`, `community-photos`, `verification-selfies`) and `LocalDiskStorageProvider` for tests.
- Upload flow: client requests a ticket (server checks photo count < 6, size ≤ 8 MB, declared type in `image/jpeg|png|webp|heic`) → client PUTs directly to the signed URL → client calls `finalizePhoto(ticketId)` → server downloads the object, sniffs the real type with `sharp`, rejects mismatches, strips EXIF (GPS), re-encodes to WebP at 1080 and 400 widths plus a blurhash, writes variants under `profile-photos/<userId>/<photoId>/{full,thumb}.webp`, deletes the raw upload, inserts `ProfilePhoto` with `moderation = PENDING`. Only variants the server produced are ever served.
- Read: `next/image` with a custom loader pointing at short-lived signed URLs (1 hour) generated server-side per render; keys never appear in client HTML for users who cannot see the profile. Community photos follow the same path with a 24 h TTL.
- Verification selfies go to a separate bucket, are never resized for display, never signed for the profile owner or other users, and are only readable by the moderation role.
- Reorder: `reorderPhotos(actor, orderedPhotoIds)` validates all ids belong to the actor, then renumbers positions in one transaction. Position 0 is the primary photo. Delete refuses to drop below the minimum of 2 once onboarding is complete.

## 7. Discovery and privacy filtering

One SQL predicate, built in `src/server/discovery/query.ts` and reused by Likes You, Matches and search, decides whether viewer V may see user U:

1. `U.status = ACTIVE` and `U.onboardingCompletedAt IS NOT NULL`.
2. `U.privacy.visibility != HIDDEN` and `U.privacy.pausedAt IS NULL` (for deck only; existing matches still see each other in chat).
3. No `Block` in either direction.
4. No `ContactHash` intersection in either direction where the owner has `blockContacts` on.
5. `U.gender` matches V's `interestedIn`, and V's gender matches U's `interestedIn`. "Prefer not to say" is shown to users who selected Everyone.
6. Age within V's range (computed from DOB in SQL); location filter (`Anywhere`, `Greater Malé`, `My atoll`, specific city) by join on `Location`; intent filter.
7. Not already liked, matched or passed within 30 days by V.
8. Invisible Mode (Plus): if U has `invisibleMode` on, U appears to V only if U has liked V **and** U currently holds the `invisibleMode` entitlement. If U's Plus has lapsed the clause fails closed and U is not shown to anyone new (see section 12.6). The prototype's "Only people I like" visibility option and "Incognito mode" toggle both map to this single Plus feature.
9. Advanced filters (island, atoll, age range, intention, height, education) are applied only when `can(V, "advancedFilters")`.

Ordering: active boost first (section 12.8), then verified, then recently active, then by a per-user seeded random so refreshes do not reshuffle. Passed profiles do not reappear for 30 days unless the pass was undone.

Public DTO (`VisibleProfile`) contains: id (public handle, not the database id), name, age (or null when `hideAge`), location label (or null when `hideLocation`), verified flag, job, education, languages, height, bio, intent, interests, prompts with answers, photo signed URLs with blurhashes, `isActiveNow` (or null when hidden). It never contains phone, DOB, email, coordinates, internal ids, privacy flags or moderation status. `hideAge` is honoured everywhere including cards and match screens.

## 8. Likes, matching and intros

- `like(actor, targetHandle, intro?)`: resolves target, runs the visibility predicate (a like against someone you cannot see is rejected), then in one transaction: insert `Like` (unique violation → idempotent success), insert `Intro` if provided and permitted, check for the reverse `Like`, and if present `INSERT ... ON CONFLICT DO NOTHING` a `Match` keyed on the sorted pair, create the `Conversation` and both participants, convert any pending intro messages into the conversation, and create `NEW_MATCH` notifications for both users. The transaction returns `{ matched: boolean, conversationId? }`, which the client uses to show the match overlay. Two concurrent mutual likes cannot double-match because the unique index resolves the race and the second transaction sees `matched: true` via the conflict path.
- `pass(actor, targetHandle)` inserts `Pass` with `expiresAt = now + 30d`, idempotent. Passes never consume the like allowance.
- Like allowance: 30 likes per rolling 24-hour window for Free, 90 for Plus, enforced inside the like transaction by the usage-window mechanism in section 12.3. Undo (Plus) reverses only the most recent Pass, see section 12.7.
- Likes You: free users get the count and anonymised tiles built from server-side blurhash placeholders only (no photo URL, no id, no name, no location leaves the server). Plus users get the full DTO. See section 12.5.
- Intros: free users may send 1 per ISO week, Plus unlimited. An intro creates a `Message` of kind `INTRO` in a `PENDING` conversation visible only to the sender until a match; the recipient sees the intro text on the liker's tile and in the match screen. On match, the conversation becomes `ACTIVE` and the intro is the first message. Quota, length (140) and permission are all enforced in `src/server/intros`.

## 9. Messaging

- Authorization is a single function: `getConversationForActor(actor, conversationId)` joins `ConversationParticipant` on the actor and throws `NotFound` (not `Forbidden`, to avoid confirming existence) if absent, if the conversation is `LOCKED`, or if either party has blocked the other. Every read and write goes through it. Ids in URLs are opaque cuids; enumeration yields nothing.
- `sendMessage(actor, conversationId, body)`: body 1–2000 chars after trim, conversation must be `ACTIVE`, the sender's global message cooldown must have elapsed (Free: 9 minutes between outgoing messages across all conversations; Plus: none; enforced transactionally, see section 12.4), then insert and create a `MESSAGE` notification for the other participant (deduplicated: one unread notification per conversation). An anti-spam ceiling of 30 messages per minute applies to everyone, Plus included. Receiving and reading are never delayed for anyone.
- History is paginated backwards by cursor (50 per page). Read state: `lastReadMessageId` per participant; read receipts are shown to the other party only if both have `readReceipts` on.
- Optimistic UI: the client appends a pending bubble, then reconciles with the returned message id; failures mark the bubble and offer retry.
- `MessagingTransport`: `subscribe(conversationId, onMessage)`. `PollingTransport` (3 s while the view is focused) ships first. `SupabaseBroadcastTransport` follows: the server publishes `message.created` to a private channel `conversation:<id>` after commit; clients subscribe with a short-lived token the server mints only after the same participant check. Realtime is a delivery optimisation, never a source of truth or an authorization boundary.

## 10. Safety: block, report, unmatch

- Block: inserts `Block`, sets any `Match` between the pair to `BLOCKED` and its conversation to `LOCKED`, removes pending likes/intros in both directions, and creates no notification for the blocked user. Blocked users disappear from every list via the shared predicate. Unblock is available from Settings → Blocked users and does not restore the match.
- Report: stores reporter, target (user/post/message), reason enum (the eight prototype reasons), optional note and a snapshot of the reported content (message text or post text and photo keys) so later deletion does not destroy evidence. Reporting a user also blocks them, as in the prototype. Reports are anonymous to the reported user.
- Unmatch: sets `Match.status = UNMATCHED`, `Conversation.status = LOCKED`, records who unmatched. Messages are retained. Neither user can message; the conversation is hidden from both lists; a later mutual like creates a new match and a new conversation.
- Moderation foundation: `User.role` (`USER`, `MODERATOR`, `ADMIN`) is only writable via a database migration or a CLI script, never via any action. `src/server/moderation` exposes read models for open reports, flagged users, verification queue and community reports. No admin UI is built in this phase; the data is queryable and the domain functions exist so an admin surface can be added without schema changes.

## 11. Verification

State machine in `src/server/verification`: `NONE → PHONE_VERIFIED` (automatic after OTP) `→ SELFIE_SUBMITTED` (selfie uploaded) `→ UNDER_REVIEW → VERIFIED | REJECTED`. `REJECTED` allows a retry after 24 h. `VerificationProvider` interface: `submit(userId, selfieKey, profilePhotoKeys) → { providerRef, status }` and `onWebhook(payload)`. Default implementation is `ManualReviewProvider`, which sets `UNDER_REVIEW` and leaves the decision to a moderator. The UI shows exactly the prototype's four screens driven by real status; no step is auto-completed. The profile badge renders only for `VERIFIED`.

## 12. Monetization: Thundi Plus, entitlements and usage limits (approved 2026-09-17)

This section supersedes every earlier statement about like caps, incognito mode, rewind and plan pricing in this document and in the prototype audit. Registration is free and the core dating loop stays usable without paying.

### 12.1 Approved product rules

| Rule | Free | Plus |
| --- | --- | --- |
| Registration, profile, photos, discovery, matching | included | included |
| Likes | 30 per rolling 24-hour window | 90 per rolling 24-hour window |
| Pass | unlimited, never consumes likes | unlimited |
| Chat with matches | included | included |
| Sending messages | 1 outgoing message every 9 minutes, global across all conversations | no cooldown |
| Receiving and reading messages | never delayed | never delayed |
| Likes You | count and anonymised placeholders only | full profiles |
| Invisible Mode | not available (upsell) | enabled |
| Profile Boosts | none | 2 per rolling 7-day window |
| Advanced filters | basic filters only | enabled |
| Undo last Pass | not available | enabled |
| Intro with a like | 1 per ISO week (prototype rule, unchanged) | unlimited |

Subscription pricing: **not yet approved**. Payment provider: **not yet selected**. Development pricing is placeholder data flagged as such in the database and the UI.

### 12.2 Single source of truth: product configuration and the entitlement service

All numbers live in one typed module, `src/config/product.ts`:

```ts
export const PRODUCT_RULES = {
  FREE: { dailyLikeLimit: 30, messageCooldownMs: 9 * 60_000, canSeeIncomingLikes: false,
          canUseInvisibleMode: false, boostsPerWindow: 0, canUseAdvancedFilters: false,
          canUndoPass: false, introsPerWeek: 1 },
  PLUS: { dailyLikeLimit: 90, messageCooldownMs: 0, canSeeIncomingLikes: true,
          canUseInvisibleMode: true, boostsPerWindow: 2, canUseAdvancedFilters: true,
          canUndoPass: true, introsPerWeek: null /* unlimited */ },
} as const satisfies Record<Tier, TierRules>;

export const USAGE_WINDOWS = { LIKES: 24 * 3_600_000, BOOSTS: 7 * 24 * 3_600_000 } as const;
export const BOOST = { durationMs: 30 * 60_000, rankingWeight: 1 } as const;
export const UNDO = { maxAgeMs: 60 * 60_000 } as const;
export const MESSAGE_SPAM_CEILING = { perMinute: 30 } as const;
```

The entitlement service (`src/server/entitlements`) is the only code that reads subscriptions and this table:

```ts
resolveTier(userId, now): Promise<Tier>                 // FREE | PLUS, from Subscription + EntitlementOverride
getEntitlements(userId, now): Promise<Entitlements>      // tier + the TierRules row + subscription summary
getLikeAllowance(userId, now): Promise<{ limit, used, remaining, resetsAt }>
getMessageAvailability(userId, now): Promise<{ canSendNow, availableAt, cooldownMs }>
getBoostAllowance(userId, now): Promise<{ limit, used, remaining, resetsAt, activeBoostEndsAt }>
can(entitlements, "seeIncomingLikes" | "invisibleMode" | "advancedFilters" | "undoPass")
```

Tier resolution: a user is `PLUS` when an `EntitlementOverride` covering `now` exists, or a `Subscription` has `currentPeriodEnd > now` and status in `ACTIVE`, `TRIALING`, `PAST_DUE` or `CANCELLED` (cancelled subscriptions keep their paid period; `EXPIRED` never grants). No code outside this module compares tiers or reads subscription rows; components receive already-derived booleans and numbers.

### 12.3 Like allowance: rolling 24-hour usage window

Semantics (approved): the window opens at the first like after the previous window has ended and closes exactly 24 hours later. Likes inside the window count against the limit; passes never do. The window is not anchored to midnight in any time zone and there is no cron.

Implementation: table `UsageCounter (userId, kind, windowStart, windowEnd, used)`, one row per user per kind. `like()` runs a single transaction:

1. `SELECT ... FROM "UsageCounter" WHERE "userId" = $1 AND kind = 'LIKES' FOR UPDATE` (inserting the row first with `ON CONFLICT DO NOTHING` if absent). The row lock serialises all concurrent likes by this user.
2. If `now >= windowEnd`, reset: `windowStart = now`, `windowEnd = now + 24h`, `used = 0`.
3. Resolve `limit` from the entitlement service (Free 30, Plus 90) inside the same transaction.
4. If `used >= limit`, roll back and return `LikeLimitReached { resetsAt: windowEnd, limit }`.
5. Insert the `Like`. If it already exists (unique violation), return idempotent success without incrementing.
6. `used += 1`, then the match check from section 8.

Because step 1 takes an exclusive row lock, five simultaneous requests with one like remaining execute one after another: the first increments `used` to the limit and the other four see `used >= limit`. Refreshing, changing device or logging out cannot affect the row. The UI reads `getLikeAllowance` to show "12 likes left today" or "Your 30 free likes will refresh in 6h 24m" using `resetsAt` from the server. Changing the policy later (for example sliding windows or per-day anchors) means changing steps 2 and 3 in one function.

### 12.4 Message cooldown: 9 minutes, global, server-enforced

Semantics: a Free user's outgoing messages to matches are spaced at least 9 minutes apart, measured from the previous outgoing message regardless of conversation. Receiving and reading are unaffected. Plus has no cooldown.

Implementation uses existing message rows plus a per-user transaction lock, with no extra table:

1. `sendMessage()` opens a transaction and calls `pg_advisory_xact_lock(hashtext('msg:' || userId))`, serialising all sends by this user for the duration of the transaction.
2. Resolve entitlements. If `messageCooldownMs > 0`, read `MAX("createdAt") FROM "Message" WHERE "senderId" = $1 AND kind = 'TEXT'` (indexed on `(senderId, createdAt)`). If `now - last < cooldownMs`, roll back and return `MessageCooldown { availableAt: last + cooldownMs }`.
3. Check the conversation is `ACTIVE` and the sender is a participant (section 9), apply the anti-spam ceiling, insert the message, commit.

Two simultaneous sends therefore run sequentially; the second sees the first message's timestamp and is rejected. Disabling the Send button is a courtesy only; any direct call to the action during the cooldown gets the same rejection with `availableAt`, which the client renders as "Free message available in 6:42" and uses to re-enable Send at the right moment. A user who downgrades from Plus is measured from their last message like anyone else.

### 12.5 Likes You

Free: the read model returns `{ count, placeholders: [{ blurhash, verified }] }` where the blurhash is the primary photo's precomputed 28-character placeholder stored on `ProfilePhoto`. It contains no identifier, name, age, location or URL, and the list order is randomised per request so it cannot be aligned with other lists. Plus: the read model returns full `VisibleProfile` DTOs through the standard visibility predicate. There is no route that serves the real image to a Free client.

### 12.6 Invisible Mode

Stored as `PrivacySettings.invisibleMode` (the user's wish). It is effective only while the user holds the entitlement. In the discovery predicate, candidate U is shown to viewer V only if:

```
ps.invisibleMode = false
OR (
  EXISTS (active Plus entitlement for U at now)
  AND EXISTS (SELECT 1 FROM "Like" l WHERE l."fromUserId" = U.id AND l."toUserId" = V.id)
)
```

Consequences: A (invisible, Plus) likes B → B can now discover A. C, whom A has not liked, never receives A. Existing matches and conversations are unaffected because they are read through `Match`/`ConversationParticipant`, not through discovery. Likes You for B includes A normally.

Lapse semantics (documented decision): when Plus expires with `invisibleMode = true`, the predicate's second branch fails, so the user is **not** exposed. They are effectively paused from Discover until they renew or turn the flag off (which restores normal visibility). This fails closed for privacy while granting nothing premium for free. The lapse creates an `ACCOUNT_NOTICE` notification explaining the state, and the Privacy screen shows it. Turning the flag on as a Free user is refused by the action and leads to the Plus upgrade experience.

### 12.7 Undo (last Pass)

Plus only. `undoLastPass(actor)` finds the actor's most recent `Pass` with `undoneAt IS NULL`, requires that it is the actor's most recent swipe action of any kind (no later `Like` or `Pass` exists), and that it is younger than `UNDO.maxAgeMs` (60 minutes). It sets `undoneAt = now` inside a transaction that locks the pass row and returns the profile so the client can put it back on top of the deck. Discovery excludes only passes with `undoneAt IS NULL`. Nothing is deleted, only the latest action can be reversed, and only once.

### 12.8 Profile Boosts

Plus allowance 2 per rolling 7-day window, using the same `UsageCounter` mechanism with `kind = 'BOOSTS'` and a 7-day window (Free limit 0, so any Free activation is rejected). Activation inserts a `Boost (userId, startsAt, endsAt = startsAt + BOOST.durationMs)`. Only one boost may be active at a time. Discovery ordering places candidates with an active boost first; the weight and duration live in `src/config/product.ts`, not in query code. Copy never claims a multiplier: "Get seen sooner" / "Temporarily increase your visibility in discovery."

### 12.9 Advanced filters

Free: age range, show me, location (Anywhere / Greater Malé / My atoll / specific city), intention, as in the prototype. Plus adds: specific island or atoll selection, height range, education, and combined filters. Distance is deliberately absent and no coordinates exist in the model.

### 12.10 Plans, subscriptions and payments

- `SubscriptionPlan` rows: `WEEKLY`, `MONTHLY` (badge "Most popular"), `QUARTERLY` (badge "Best value"). Prices are placeholders flagged `isPlaceholderPrice = true`; the UI must render a "development pricing" notice while any displayed plan carries that flag. Final MVR pricing is pending approval.
- `Subscription` fields as listed in section 5. Status transitions come only from `PaymentProvider.handleWebhook` or an admin action; no user-facing action can create or activate a subscription.
- `PaymentProvider` interface: `createCheckout(userId, planCode) → { redirectUrl }`, `handleWebhook(rawBody, signature) → SubscriptionEvent[]`, `cancel(subscriptionRef)`. Default `NotConfiguredPaymentProvider` makes the subscribe CTA explain that payments are not yet available. No card data is ever stored.
- Upsell UX: limits surface as calm in-context prompts ("You've used today's 30 likes. More available in 4h 12m. [Get Thundi Plus] [Maybe later]", "Next free message in 7:24 [Get Thundi Plus] [Wait]"). Reading a conversation is never blocked. The Plus screen and plan selection are built in a later phase using the Thundi visual identity; the supplied Muzz screenshots inform structure only.

### 12.11 Concurrency guarantees, summarised

| Limit | Serialisation mechanism | Why it holds |
| --- | --- | --- |
| Likes per window | `SELECT ... FOR UPDATE` on the user's `UsageCounter` row inside the like transaction | Concurrent transactions queue on the row lock; each re-reads `used` after acquiring it. |
| Duplicate like | unique index `(fromUserId, toUserId)` | Second insert conflicts; treated as idempotent success without consuming quota. |
| Message cooldown | `pg_advisory_xact_lock` per sender + `MAX(createdAt)` check inside the transaction | Concurrent sends queue on the advisory lock; the second sees the first's committed row. |
| Boosts per window | same `UsageCounter` row lock, kind BOOSTS, plus a check for an already-active boost | as likes |
| Undo | row lock on the latest pass + "is latest action" check | Only one reversal can win; nothing else is mutated. |
| Mutual match | unique `(userAId, userBId)` with `ON CONFLICT DO NOTHING` | as section 8 |

All of these are covered by integration tests that fire parallel transactions against a real Postgres (section 17).

## 13. Notifications

Types: `NEW_MATCH`, `MESSAGE`, `LIKE_RECEIVED` (Plus users see who; free users get a count-only notification), `INTRO_RECEIVED`, `COMMUNITY_LIKE`, `COMMUNITY_COMMENT`, `VERIFICATION_UPDATE`, `SAFETY_NOTICE`, `ACCOUNT_NOTICE`. Created inside the same transaction as the triggering write. Read model returns unread counts per tab for badges; `markRead(actor, ids | all)`. `NotificationSettings` (matches, likes, messages, community, marketing) gate creation of the non-safety types. A `PushSubscription` table is included in the schema so Web Push can be added without migration; no push is sent in this phase.

## 14. Community

Posts (text, question, photo) with author, location label, timestamps; comments; likes. Cursor pagination on `(createdAt, id)`. Tabs: For You (all, ranked by recency and likes), Following (hidden until a follow feature exists, rendered as an empty state saying so), New (chronological). Reporting a post uses the same report sheet with `targetPostId`. Blocked users' posts and comments are filtered through the shared block predicate. Community posts never create likes or matches (as the prototype states).

## 15. Security controls summary

| Threat | Control |
| --- | --- |
| IDOR on profiles, conversations, photos, posts | Actor derived from session; every read model filters by actor; opaque ids; NotFound instead of Forbidden. |
| Forged user ids in payloads | Zod schemas do not accept `userId`; domain functions take `actor`. |
| Duplicate likes / matches | Unique constraints plus `ON CONFLICT` inside one transaction. |
| OTP brute force / abuse | Hashed codes, 5 attempts, 5 min expiry, per-phone and per-IP sliding-window limits, resend cooldown, constant-time compare. |
| Session theft | HttpOnly Secure cookie, hashed token at rest, idle and absolute expiry, logout-everywhere. |
| XSS | React escaping; no `dangerouslySetInnerHTML`; CSP with nonces; user text rendered as text. |
| CSRF | Server actions same-origin; mutating route handlers check `Sec-Fetch-Site`/`Origin`; webhooks verify signatures. |
| Malicious uploads | Signed tickets, size cap, MIME sniffing with `sharp`, re-encode, EXIF strip, private buckets, server-produced variants only. |
| Enumeration | Uniform OTP responses; opaque handles; rate limits on lookup endpoints. |
| Spam | Message and post rate limits, daily like cap for free users, report pipeline. |
| Secret exposure | `env.ts` splits server/public; only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public; the secret key never leaves the server. |
| Minor access | DOB required, server-side age check on onboarding completion and on every login; moderator-only DOB edits. |
| Privilege escalation | `role` and `Subscription` are not writable by any user-facing action. |
| Evidence destruction | Soft deletes for messages, posts, matches; report snapshots. |

## 16. Environment variables

`.env.example` will contain, with comments:

```
DATABASE_URL=            # pooled, transaction mode, ?pgbouncer=true&connection_limit=5
DIRECT_DATABASE_URL=     # session pooler or direct; used by prisma migrate/seed
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_...
SUPABASE_SECRET_KEY=                    # sb_secret_... server only
SESSION_SECRET=          # 32+ bytes, used to HMAC phone lookups and sign upload tickets
OTP_PEPPER=              # 32+ bytes
CONTACT_HASH_SALT=       # 32+ bytes, see CONTACT_BLOCKING.md
SMS_PROVIDER=console     # console | <gateway> (gateway credentials documented when chosen)
PAYMENT_PROVIDER=none
VERIFICATION_PROVIDER=manual
THUNDI_DEV_OTP_ECHO=true # dev only; boot fails in production if set
APP_URL=http://localhost:3000
```

Supabase now issues `sb_publishable_*` and `sb_secret_*` keys; the legacy `anon`/`service_role` keys still work until end of 2026 but the code will use the new names.

## 17. Testing strategy

- Unit (Vitest): age calculation across time zones and leap days, phone normalisation, OTP hashing and attempt rules, entitlement derivation, completion percentage, intro week keys.
- Integration (Vitest against Postgres): under-18 rejection at onboarding completion; duplicate like idempotency; mutual like creates exactly one match under concurrency (two parallel transactions); blocked users excluded from deck, likes-you and chat; conversation and message authorization for non-participants; intro quota per week; report creation with snapshot; privacy filtering (hidden location/age, hidden visibility); premium checks for likes-you and advanced filters.
- Monetization (Vitest against Postgres, required): Free allowance is 30 and Plus 90; like consumes, pass does not; 30th succeeds and 31st is rejected with `resetsAt`; allowance restores after the 24-hour window; session/device changes do not reset it; N concurrent likes with one remaining yield exactly one success; expiry of Plus returns the user to Free limits. Messaging: matched Free user sends, immediate second send rejected, allowed after 9 minutes, cooldown spans conversations, receiving/reading unaffected, Plus has no cooldown, direct calls during cooldown rejected, simultaneous sends yield one success. Invisible Mode: normal discoverability, hidden from non-liked users, visible after liking, matches unaffected, lapsed Plus fails closed. Likes You: Free receives no identifying fields, Plus receives profiles. Boosts: Plus allowance 2 per 7 days, window enforced, Free rejected.
- E2E (Playwright, dev OTP): onboarding happy path, swipe by buttons and keyboard, match modal, send message, block from profile.
- CI: typecheck, lint, unit + integration on a Postgres service container, production build.

## 18. Delivery plan mapping

| Phase | Output |
| --- | --- |
| 3 Database (done) | `prisma/schema.prisma`, migration `20260917152844_init`, seed (reference + dev-only demo data), `src/lib/db.ts`, `prisma.config.ts`, plus the monetization domain layer (`src/config/product.ts`, `src/server/{entitlements,usage,discovery,likes,matching,conversations,boosts,privacy}`) and its database-backed tests. Not yet applied to the hosted Supabase project. |
| 4 Design system | `tokens.css`, Tailwind theme, `components/ui/*`, layout shell, storybook-free preview route under `(dev)/ui` in development only. |
| 5 Auth + onboarding | OTP flow, sessions, `proxy.ts`, 12 steps with server-persisted progress, photo upload pipeline. |
| 6 Discovery | Deck query, cards, gestures, filters. |
| 7 Matching + likes | Like/pass/match transaction, Likes tab, match overlay, intros. |
| 8 Messaging | Conversations, authorization, polling transport, read state. |
| 9 Community | Feed, compose, comments, likes, report. |
| 10 Profile + settings | Edit sections, completion, privacy, settings, safety actions. |
| 11 Plus + verification | Entitlements, plan UI, provider stubs, verification state machine. |
| 12 Hardening | Tests, CSP, rate limits review, build, security review. |

## 19. Decisions taken without asking (reversible)

- Own session/OTP layer instead of Supabase Auth.
- Polling before Realtime.
- Blurred likes are pre-blurred server-side rather than CSS-blurred (CSS blur leaks the real image).
- Passed profiles resurface after 30 days.
- Invisible Mode fails closed on Plus lapse (user stays hidden rather than being exposed), see 12.6.
- Undo window of 60 minutes and boost duration of 30 minutes are configuration defaults pending product review.
- The prototype's free "Only people I like" visibility option is folded into the Plus-only Invisible Mode, per the approved monetization rules.
- Community "Following" tab ships as an explanatory empty state rather than being removed.
- TypeScript pinned to 5.9 rather than 7.0.

## 20. Open items needing the owner

- Supabase credentials: `sb_publishable_*`, `sb_secret_*`, and the two database URLs for project `qkubuaicuyoaskzcabcu`. I will create the storage buckets and apply migrations through the Supabase tooling once provided and instructed; nothing destructive will be run against that project, and it is currently empty.
- SMS gateway choice (Dhiraagu/Ooredoo business SMS, or an international provider). The interface is provider-agnostic.
- Payment provider for MVR (BML payment gateway or equivalent). The interface is provider-agnostic.
- Subscription pricing (weekly / monthly / 3-month). Seeded plans carry placeholder prices flagged `isPlaceholderPrice`.
- Product review of configuration defaults: Undo window (60 min), boost duration (30 min), pass resurfacing (30 days), anti-spam ceiling (30 messages/minute).
- Invisible Mode lapse semantics (fail closed, §12.6) — implemented as documented; confirm or change.
