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
- Community is server-rendered with the first For You page (12 posts); the client pages through the rest with an opaque keyset cursor (intersection observer plus a Load more button). `/community/[postId]` is the thread route and, like a conversation, hides the phone bottom nav (§14).
- Caching: nothing user-specific is cached. Public reference data (islands, interests, prompts, plans) uses `"use cache"` with long revalidation. All authenticated pages are dynamic.
- Loading states: every route has `loading.tsx` with skeletons in the prototype's geometry. Every route has `error.tsx` using the empty-state pattern with a retry action. Offline: a small client hook shows a toast-style banner when `navigator.onLine` is false and disables sends.

## 4. Authentication and sessions

### 4.1 Sign-in: Google only (as built in the Google-auth migration, after Phase 9)

Authentication is "Continue with Google" and nothing else: no SMS OTP, no email code, no password, no hidden fallback. Google authenticates the person; **`User.id` remains the canonical identity** for every relation (profile, photos, likes, passes, matches, conversations, messages, Community, blocks, reports, settings, subscriptions, audit). Google is an authentication provider, not our relational identity.

- **Flow** (`/auth/google/start` → Google → `/auth/google/callback`, both route handlers): authorization-code flow with PKCE (S256), a random `state` and `nonce`. State, nonce and the PKCE verifier live in a signed HttpOnly cookie (`thundi_oauth`, 10 minutes, `src/lib/oauth-cookie.ts`). The callback compares the state in constant time, exchanges the code with the verifier and client secret at Google's token endpoint, and verifies the ID token: RS256 signature against Google's JWKS (cached, refreshed once on an unknown `kid`), issuer (`https://accounts.google.com` / `accounts.google.com`), audience (our client id), expiry, nonce, subject, and `email_verified`. Only `alg: RS256` (Google) or `HS256` (dev stand-in) is accepted; `none` is rejected. Code: `src/server/auth/{jwt,oidc}.ts`.
- **Mapping** (`src/server/auth/identity.ts`): `AuthIdentity (provider, providerSubject)` → `User`. The key is Google's stable `sub`, never the email (emails change and are not identity). Unknown subject → a new ONBOARDING account with every settings row and `Verification.status = NONE`, created race-safely (concurrent first sign-ins converge on one account, tested). Known subject → the same `User.id` every time; email and display name refresh from the token. SUSPENDED/BANNED → no session. DELETED → §4.4.
- **What Google does not prove**: control of a phone number or the person's identity for dating. Nothing sets `PHONE_VERIFIED` any more (existing rows were migrated to `NONE`; the enum value is legacy), the Verification screen has no phone step, and sign-in never grants the verified seal. Selfie/profile verification stays a separate workflow (§11).
- **Phone as optional data**: `User.phoneE164` / `phoneHash` are now nullable. They are profile / contact-blocking data (docs/CONTACT_BLOCKING.md), not credentials. A user without a phone is fully functional; contact blocking still applies through their own hidden list, while nobody can hide from them through a number they never provided (tested). Adding a phone in Settings is future work; `normalizeMaldivianPhone`, `maskPhone` and `hashPhone` remain for that and for contact hashing.
- **Provider abstraction**: `OidcProvider` with `GoogleOidcProvider` (production) and `DevOidcProvider` (`AUTH_PROVIDER=dev`, development and tests only). The dev provider is a local stand-in for Google's consent screen (`/dev/google/authorize`, 404 in production) that issues its own signed codes bound to redirect URI, nonce and PKCE challenge and mints HS256 ID tokens; the app's start/callback code is identical in both modes. Production requires `AUTH_PROVIDER=google` with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; `src/lib/env.ts` refuses a production boot with the dev provider or without the client (tested). Redirect URI: `${APP_URL}/auth/google/callback` — it must be registered on the Google OAuth client (§20).
- **Failures** land on `/auth/error?reason=…` (cancelled, state, token, session, identity, unavailable, provider) with no account detail; enumeration is not possible because sign-in creates or resumes without ever saying which.
- **Existing accounts**: the hosted database has never been migrated, so no real phone-authenticated users exist. Development demo accounts receive an explicit seeded identity per demo key (`dev-<key>`, `<key>@demo.thundi.dev`) — a mapping defined by the seed, never guessed from names; their demo phones stay as optional contact-blocking data. Any other locally created phone-only account has no identity and simply cannot sign in (nothing is merged or deleted); if real phone-only users ever existed, the safe path would be an in-app "link your Google account" step while signed in, not an automatic merge.

### 4.2 Sessions (as built)

- Opaque 32-byte token (base64url) in cookie `thundi_session`: `HttpOnly; SameSite=Lax; Path=/`, `Secure` in production. The database stores only `sha256(token)` plus user id, created/lastSeen/expires, user agent and the IP /24 prefix.
- 30 days idle, 90 days absolute, sliding refresh at most hourly; expired rows are deleted on first sight. Logout (`POST /auth/logout`, same-origin checked, or the Settings action) revokes exactly that session; `revokeAllSessions` exists for "log out everywhere". `Session.reauthenticatedAt` records a fresh Google re-authentication for destructive actions (§4.4).
- Route protection has two layers with no possible loop (`src/server/auth/route-access.ts`, unit-tested): `proxy.ts` sees only cookie presence and bounces anonymous requests away from `/onboarding` and the app; the server layouts call `getAuthState()` (React `cache`, one lookup per request) and apply `resolveAccess`: anonymous → `/` (welcome, Continue with Google), onboarding → `/onboarding`, active → `/discover`. The sign-in start/callback and logout endpoints are allowed for every state (they decide for themselves). Suspended, banned or deleted accounts cannot sign in (`ACCOUNT_UNAVAILABLE`) and an existing session for them resolves as anonymous. Server actions never accept a user id; `requireActor()` derives it from the session and Zod strips unknown keys.
- CSRF: server actions are same-origin by construction; the mutating route handlers (`/api/photos`, `/api/community/posts`, `/auth/logout`) refuse cross-site `Sec-Fetch-Site`; the OAuth callback is bound to the browser that started it by the signed state cookie. Baseline headers from `proxy.ts`: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera self, geolocation denied). A nonce-based CSP is scheduled for Phase 12 hardening.

### 4.3 Age gate and onboarding state (as built)

- Onboarding progress is a named pointer, `User.onboardingStage` (`NAME → DOB → GENDER → MEET → INTENT → LOCATION → PHOTOS → ABOUT → PRIVACY → COMPLETE`), never a numeric step. Each stage saves immediately and advances the pointer only forwards; going back and editing never moves it backwards; `COMPLETE` is set only by `completeOnboarding`, which re-validates every required field and the age on the server before switching the account to `ACTIVE`. `/onboarding` resumes at the pointer; a URL for a later stage redirects to it.
- Date of birth is validated as a real calendar date and `ageFromDateOfBirth(dob, now) >= 18` on the server (UTC, tested at exactly 18 and 17 years 364 days). A refused date is never stored. DOB lives only on `User.dateOfBirth`; profile DTOs expose the derived `age` and the owner's onboarding data exposes day/month/year only to the owner.
- Required to finish: name, DOB, gender, who to meet, intention, location and at least two non-rejected photos. Bio, interests, prompts and verification are optional and feed the completion percentage (`src/server/profiles/completion.ts`, single source of truth for both the onboarding "done" screen and the Profile ring).

### 4.4 Account actions: log out, pause, delete (as built in Phase 9)

- **Log out** (Settings → Account management) revokes exactly the current session (`revokeSession`) and clears the cookie. The prototype has no "log out everywhere"; `revokeAllSessions` remains available for support tooling.
- **Pause dating** (prototype "Pause Dating" / Privacy visibility "Hidden") sets `PrivacySettings.visibility = HIDDEN` and `pausedAt`. The user leaves Discover (`discoverableSql`), receives no deck (`emptyReason = PAUSED`) and cannot send likes (`likeUser` refuses with `InvalidStateError`), otherwise pausing would be Invisible Mode for free. Matches, conversations and Community are untouched. Resuming clears both fields. This is the prototype's only deactivation concept; no separate "deactivate" state was invented.
- **Delete account** requires recent authentication with Google (`src/server/auth/recent-auth.ts`): the sheet's first step explains the consequences; "Continue with Google to confirm" runs `/auth/google/start?purpose=reauth`, which binds the result to the current session id and, on a verified token **for the same identity** (`recordReauthentication` refuses any other Google account), sets `Session.reauthenticatedAt`. Back in Settings the second step, "Delete my account", calls `deleteAccount`, which atomically consumes a mark younger than five minutes on **this** session and refuses otherwise (`REAUTH_REQUIRED`). An old application session, another of the user's sessions, or a stale confirmation can never delete an account (tested). Deletion runs in one transaction and **anonymises** rather than hard-deletes: photos (rows and files), interests, prompts, profile text, likes, passes, notifications, contact hashes, push subscriptions and sessions are removed; posts and comments are soft-deleted with counters recomputed; active matches become UNMATCHED and their conversations LOCKED; the User row becomes `status = DELETED` with no phone, DOB or gender and a random `phoneHash`. The sign-in identity row is **kept** with its email and name scrubbed and `releasedAt` set. **Kept**: Report, Block, Message history, AuditLog (`account.deleted`), Subscription rows. Open policy: §20.
- **The same Google account after deletion** (`/auth/deleted`): the callback recognises the subject of a deleted account and shows "Your previous Thundi account was deleted" instead of signing in; nothing is revived automatically. Only the explicit "Create a new account" choice (`createFreshAccountForIdentity`) creates a brand-new `User` and moves the identity row to it (audit `account.recreated`); the deleted row keeps its anonymised state and safety records and loses the identity link. Signing in later lands on the new account. The choice is refused for identities whose account is not deleted. Tested end to end.

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

## 6. Storage and photos (as built in Phase 5)

- `StorageProvider` (`src/lib/storage/provider.ts`): `put(key, bytes, contentType)`, `delete(key)`, `getReadUrl(key, ttlSeconds)`. `LocalDiskStorageProvider` (development and tests) writes under `LOCAL_STORAGE_DIR` and serves through `/api/media/<key>?exp&sig`, an HMAC-signed expiring URL verified in constant time. `SupabaseStorageProvider` uploads with the server secret key to the private bucket `SUPABASE_STORAGE_BUCKET_PHOTOS` and returns Supabase signed URLs. Keys are validated against path traversal. The provider is chosen by `STORAGE_PROVIDER`; production refuses `local`.
- Upload flow: the browser posts one file to `POST /api/photos` (multipart, XHR for real progress, same-origin only, session required). The server caps the body at 8 MB, sniffs the real format with `sharp` (JPEG, PNG, WebP; the declared MIME type is ignored), requires at least 400 px on each side, strips all metadata by re-encoding to WebP at 1080 (full) and 400 (thumb) widths, computes a blurhash, and writes `profile-photos/<userId>/<photoId>/{full,thumb}.webp`. The profile row is locked `FOR UPDATE` while counting so the maximum of six holds under concurrent uploads (tested). Rows are inserted with `moderation = PENDING`; a `REJECTED` photo is never the primary and does not count towards the minimum of two.
- Read: DTOs carry signed URLs (1 h) generated per render; storage keys never reach the client. Reorder validates that the id set is exactly the actor's photos and renumbers in one transaction (position 0 is primary); delete removes the row and both objects and renumbers. Ownership is resolved through `profile.userId`, and a foreign id answers NotFound.
- Community photos and verification selfies follow the same provider in later phases (separate buckets, verification never signed for display).

### 6.1 Editing photos (Phase 9)

Edit profile → Photos reuses the Phase 5 pipeline and grid (`features/profile/photo-manager.tsx`, shared with onboarding): upload with progress and retry, remove, drag or button reorder, "Make main". `assertCanRemovePhoto` (in `photos.ts`) is the one place that enforces the minimum: once onboarding is complete a profile keeps at least `PHOTO_LIMITS.min` (2) non-rejected photos, so a removal that would drop below it is refused with an explanation; rejected photos can always be removed; onboarding accounts are governed by the completion gate instead. Pending photos are labelled "Under review" for the owner; other users see them only where the photo visibility policy allows (§7.1).

## 7. Discovery and privacy filtering (as built in Phase 6)

One SQL predicate, built from fragments in `src/server/discovery/predicate.ts` and assembled in `query.ts`, decides whether viewer V may see candidate U. Every list that shows one user to another (deck, Likes You, like(), profile views) uses the same fragments, so privacy is enforced in the database, never by hiding fields in components.

### 7.1 Eligibility and compatibility rules

`baseVisibleSql` (applies everywhere):

1. `U ≠ V`, `U.status = ACTIVE`, `U.deletedAt IS NULL`, `U.onboardingCompletedAt IS NOT NULL` (excludes onboarding, suspended, banned and deleted accounts).
2. No `Block` in either direction.
3. No `ContactHash` intersection in either direction where the owner has `blockContacts` on.
4. Invisible Mode: if `U.privacy.invisibleMode` is on, U is visible to V only if U **currently holds Plus** (subscription or override, evaluated in SQL by `activePlusSql`) **and** U has liked V. A lapsed Plus fails closed: U is shown to nobody new, including people U liked after the lapse (§12.6, regression-tested).

`discoverableSql` (deck only): `visibility = EVERYONE`, not paused, and at least `DISCOVERY.minDisplayablePhotos` (2) photos in a displayable moderation state. Displayable states come from one place, `src/lib/photo-policy.ts` (**photo visibility policy**): `APPROVED` and `PENDING` in development and test (there is no moderation pipeline yet), `APPROVED` only in production. `REJECTED` is never displayable anywhere. The policy is selected by `PHOTO_VISIBILITY_POLICY`; production accepts only `approved-only` and refuses to boot otherwise, so PENDING photos can never be exposed automatically. Every public surface (deck, expanded profile, match screen, chat header, side panel, Likes You) uses the same helper; no query reads `NODE_ENV`. Consequence to plan for: **production launch requires either a moderation/approval workflow that moves uploads to APPROVED, or an explicitly approved alternative policy encoded as a new value in `photo-policy.ts`** — until then newly onboarded users have no displayable photos and do not appear in Discover. The onboarding minimum ("2 photos") keeps counting non-rejected photos so sign-up is never blocked on moderation; the owner always sees their own pending photos.

`compatibilitySql` (mutual, independent of the viewer's optional filters):

5. V's "Show me" includes U's gender **and** U's "Show me" includes V's gender. `WOMEN` matches `WOMAN`, `MEN` matches `MAN`, `EVERYONE` matches all three; "Prefer not to say" (`UNSPECIFIED`) is therefore shown only to, and can only see, people who chose Everyone. Nothing assumes heterosexual pairs.
6. U has a date of birth, and V's age (derived from V's private DOB on the server) lies within U's `ageMin–ageMax`. Age preferences are mutual; location scope is not (it is V's own viewing filter, see below).

`viewerFilterSql` (V's own filters, stored on `DiscoveryPreferences`):

7. U's age (`date_part('year', age(now, dob))`) within V's `ageMin–ageMax`; optional intent; location scope `ANYWHERE` | `GREATER_MALE` (`Location.isGreaterMale`) | `MY_ATOLL` (V's own `atollCode`) | `SPECIFIC` (`locationId`). Island/atoll only: there are no coordinates or distances anywhere in the schema or the API.
8. Advanced filters (height range, education substring) are applied **only when V holds `canUseAdvancedFilters`**; stored values are inert otherwise, and `saveDiscoveryFilters` refuses to store them for Free users in the first place.

`notSwipedSql`: no Like from V to U, no unexpired un-undone Pass (30 days, `PASS_TTL_MS`), and no Match row between the pair in any status.

### 7.2 Safe DTO

The browser receives `DiscoveryCardDto` (`src/server/discovery/dto.ts`) built from `VisibleProfile`: `handle` (opaque public id), name, age or null (`hideAge`), location label or null (`hideLocation`), verified, occupation, education, languages, heightCm, bio, intent, interests, prompts, photos (signed full/thumb URLs, blurhash, width, height) and `isActiveNow` or null. `DISCOVERY_CARD_KEYS` is the exhaustive allow-list and the DTO test asserts a card has exactly those keys and that the serialised payload contains no database id, phone, DOB, storage key, moderation state, privacy flag, subscription or verification data. Hidden location and age are absent from the payload, not hidden in CSS. Actions accept handles only.

### 7.3 Batches and ranking

- A deck request returns at most `DISCOVERY.batchSize` (12, clamped to 30) cards. The client asks for the next batch when `refillThreshold` (4) cards remain and sends the handles it still holds as `excludeHandles`; combined with the persisted swipe history this guarantees adjacent batches never overlap without exposing a numeric or predictable cursor.
- Order: active Boost first, then verified, then most recently active, then `md5(candidateId || viewerId)` (a per-viewer stable shuffle), then id. Every key is deterministic for a given viewer and time. Boosted profiles cannot starve the rest: a swiped profile leaves the deck, and a batch is bounded. Boost promises ordering priority only, never a multiplier.
- `countRelaxedCandidates` (count only, no identities) distinguishes "filters too restrictive" from "nobody new" when a deck comes back empty.
- The deck query was reviewed with `EXPLAIN (ANALYZE, BUFFERS)` against the seeded development data (41 users): every per-candidate lookup uses an existing index (`Block(blockerId, blockedId)`, `Like(fromUserId, toUserId)`, `Pass(fromUserId, toUserId)`, `Match(userAId, userBId)` via the OR form, `Boost(endsAt)`, `EntitlementOverride(userId, endsAt)`, `Subscription(status, currentPeriodEnd)`, `ProfilePhoto(profileId, position)`). Sequential scans appear only on tables small enough that the planner prefers them. No index was added; none was missing.

### 7.4 Filters UI

The prototype's Filters sheet (age range sliders, Show me, Location chips, Looking for chips, Premium "Advanced filters" group, Apply) is a `ResponsiveDialog` (sheet on phones, modal on desktop) and persists to `DiscoveryPreferences` through `saveFilters`. Advanced filters offered are Height and Education, the two the profile stores; the prototype also lists Occupation and Interests, which have no filterable data model yet and are not shown.

### 7.5 Caching

`/discover` is `force-dynamic` and every deck/like/pass/undo/filter operation is a server action (a POST scoped to the caller's session cookie). Nothing personalised is put in a shared cache; Next serves dynamic pages with `Cache-Control: private, no-store`. Signed photo URLs expire after one hour.

## 8. Likes, matching and intros (as built in Phase 6)

- `likeUser(actor, targetId)`: visibility check (`canView`), then one transaction: lock the `LIKES` usage row → lazy window reset → resolve the tier's limit → **pair advisory lock** (`pg_advisory_xact_lock` on the sorted pair, `src/server/locks.ts`) → block re-check → insert `Like` (idempotent; an existing like consumes nothing) → consume one unit → supersede any Pass on the target → `createMatchIfMutual` → `LIKE_RECEIVED` notification when no match resulted. Lock order is always usage row, then pair; `blockUser` takes only the pair lock, so a block and a like on the same pair serialise and a block can never race a mutual like into an ACTIVE match (tested six rounds).
- `createMatchIfMutual`: refuses if a Block exists, then `INSERT ... ON CONFLICT DO NOTHING` on the unique sorted pair, creates or reactivates the Conversation and its participants, and writes `NEW_MATCH` notifications once per user. Two simultaneous mutual likes produce exactly one Match.
- `passUser`: records the Pass with `expiresAt = now + 30 days` (idempotent; re-passing refreshes the window). Never consumes the like allowance.
- `undoLastPass` (Plus, server-enforced): locks the actor's most recent Pass, refuses if it was already undone or a later Like exists, sets `undoneAt`. No time limit (`UNDO.maxAgeMs = null`). `undoAndRestore` returns the profile as a card only if it is still a valid deck candidate.
- `blockUser` (domain function; UI in Phase 10): under the pair lock, inserts the Block, sets an ACTIVE Match to BLOCKED and its Conversation to LOCKED, and deletes the pair's likes in both directions.
- Like allowance: 30 per rolling 24 hours for Free, 90 for Plus, enforced inside the like transaction (§12.3). The deck payload carries `limit, used, remaining, resetsAt` and `serverNow`; the client renders "You've used today's 30 likes." with a countdown from server time and refreshes the allowance when it reaches zero. Pass and browsing are never blocked by an exhausted allowance.
- Match screen: the prototype's ocean overlay ("It's a Match", "You and {name} liked each other.", Say hello / Keep swiping). "Say hello" opens `/chats/<conversationId>`, an authorised conversation shell until messaging lands in Phase 8.
- Intros (Free 1 per ISO week, Plus unlimited; `INTRO` message in a `PENDING` conversation) remain scheduled for Phase 7; the intro control is not shown on the deck until then.

## 9. Messaging (as built in Phase 7)

- **Authorization** is one function, `getConversationForActor(db, actor, conversationId)` (`src/server/conversations/messages.ts`): the conversation must have the session user as a participant and neither side may have blocked the other; otherwise `NotFound` (never `Forbidden`), so ids cannot be probed and a changed URL reveals nothing. Every read model, poll, read-mark, unmatch, report and profile view goes through it. A LOCKED conversation is still readable by its participants (history is evidence); only sending checks the status. Invisible Mode is a discovery rule and is never consulted here: matches always keep their conversations.
- **Match requirement.** A conversation exists only because `createMatchIfMutual` created it (one per sorted pair, `Conversation.userAId < userBId` unique). Sending additionally re-checks that the Conversation is ACTIVE and its Match is ACTIVE inside the transaction.
- **`sendMessage`** transaction: per-sender advisory lock (`msg:<userId>`) → participant check → pair advisory lock → block re-check → conversation/match status → entitlement at send time → Free cooldown against the sender's last persisted TEXT message → anti-spam ceiling → insert TEXT → `lastMessageAt` → sender's own read pointer → one unread `MESSAGE` notification per conversation for the other participant. Lock order (sender, then pair) is compatible with `blockUser`/`unmatchConversation` (pair only) and `likeUser` (usage row, then pair), so a send racing a block or unmatch either commits before it (and the conversation then locks) or is refused; tested five rounds.
- **Free 9-minute rule** (§12.4): one outgoing TEXT message per 9 minutes, global per sender across all conversations. Only successfully persisted TEXT messages start the timer (`COOLDOWN_QUALIFYING_KINDS`); rejected attempts, incoming messages, reads, INTRO and SYSTEM rows never do. Receiving, reading and opening chats are never delayed. **Plus** has no monetization cooldown; entitlement is resolved inside the send transaction, so Plus lapsing or activating takes effect on the very next send. The **30 messages/minute ceiling** is anti-abuse and applies to every tier, Plus included; it is never described as a subscription feature.
- **Validation:** trimmed, control characters stripped (newlines kept), 1–2000 characters (`MESSAGE_LIMITS`), TEXT only in this phase. Bodies are stored verbatim and rendered as text by React (`white-space: pre-wrap`); no HTML is ever interpreted.
- **History and polling:** `listMessages` returns the newest page (40, max 100) with a cursor for older pages; `pollConversation(afterId)` returns only messages newer than the client's newest id, oldest first, plus conversation status and the sender's availability. The client polls every 4 s while the tab is visible and online, pauses otherwise, and polls the Chats list every 10 s. `MessagingTransport` remains the seam for Supabase Realtime later: the UI consumes "new messages since X" and would not change.
- **Read state:** `markConversationRead` sets the participant's `lastReadAt`/`lastReadMessageId` and clears that conversation's `MESSAGE` notifications. It runs only when the conversation is on screen (on open, and when new incoming messages arrive while visible), never from the list. Unread counts and the Chats badge (`countUnreadConversations`) derive from persisted read state: conversations with incoming messages newer than `lastReadAt`.
- **DTOs** (`src/server/conversations/list.ts`, `messages.ts`): list rows carry the other person's handle, name, verified flag and displayable primary thumb (photo visibility policy), a 90-character preview with a "You:" flag, unread count and activity time; the header adds location (or null when hidden) and whether Unmatch is offered; messages carry `id, fromMe, kind, body, at`. No database ids of people, phone, DOB, storage keys, sender ids, moderation, subscription or report data appear; payload audits are tested. The list needs two bounded queries (rows with the latest message and participant fields; unread counts grouped by conversation).
- **Ordering:** by `lastMessageAt` (falling back to match time for unmessaged matches). Background writes (read state, `updatedAt`) never reorder. "New matches" are ACTIVE matches with no message yet; a conversation appears in one section only.
- **Optimistic send:** the bubble appears as "Sending…", is replaced by the persisted message on success, drops back into the composer on a cooldown refusal, and shows "Not sent · Tap to retry" on a network error. A refused message is never left looking sent.
- **UI:** prototype Chats list (search, New matches row, rows with unread pills), glass conversation header (avatar, name, seal, island), aqua/primary bubbles with times, 44 px composer (multiline textarea, Enter sends, Shift+Enter newline). Free cooldown copy under the composer: "Next free message in 8:42. Chat anytime with Thundi Plus." with a Get Thundi Plus text button; no automatic modals. Plus users see the plain composer. Desktop uses the prototype's master–detail (360 px list, conversation pane); the phone bottom nav hides on the conversation screen. `/chats` and `/chats/[id]` are `force-dynamic` and all mutations are session-scoped server actions.

## 10. Safety: block, report, unmatch (as built in Phase 7; settings UI in Phase 10)

- **Block** (`src/server/safety/block.ts`): under the pair lock, inserts `Block`, sets an ACTIVE Match to BLOCKED and its Conversation to LOCKED, deletes the pair's likes. Blocked pairs disappear from every list through the shared predicate and `getConversationForActor`; history is retained. No notification reaches the blocked user. From a conversation: options sheet → "Block" → confirmation dialog ("Block {name}?").
- **Report** (`src/server/safety/report.ts`): reasons are the eight approved `ReportReason` values; the target is resolved from the conversation on the server (a client-supplied target id is ignored); the report stores reporter, target, reason, optional note and a snapshot of the latest 50 messages, then blocks the target with `source = REPORT`. The confirmation copy says so explicitly ("Submitting also blocks {name}", button "Submit report and block"), followed by the prototype's "Thanks for looking out" sheet. Nothing is deleted.
- **Unmatch** (`src/server/conversations/unmatch.ts`): under the pair lock, Match → UNMATCHED (with who and when), Conversation → LOCKED, pending notifications cleared. Messages remain; neither side can send; the conversation leaves both lists and stays readable at its URL with "This conversation has ended." Offered only while the match is ACTIVE, behind a confirmation dialog.
- Moderation foundation unchanged: `User.role` is not writable by any action; report rows are queryable for the Phase 12 review surface.
- **Blocked users (Phase 9)** (`src/server/safety/blocked.ts`): Settings → Privacy → Blocked profiles lists the blocker's own blocks with the minimal identity needed to recognise someone (name, seal, avatar) and offers Unblock behind a confirmation. `unblockUser(actor, handle)` deletes only the row where `blockerId` is the session user (a foreign block or unknown handle is NotFound). It restores nothing: the Match stays BLOCKED, the Conversation LOCKED, deleted likes stay deleted, and nobody is notified; future discovery simply follows the normal predicate again.
- **Block my contacts (Phase 9)**: the user-facing part of docs/CONTACT_BLOCKING.md. The card records `blockContacts`; "Manage blocked contacts" opens a sheet that uses the Contact Picker API where the browser has one and otherwise takes typed or pasted numbers, normalises them with the same Maldivian rules as sign-in, hashes them in the browser with WebCrypto HMAC-SHA-256 and the public salt (`getContactHashKey`, identical to `hashPhone`) and sends only 32-byte digests (`addContactHashes`: ≤ 5000 per call, ≤ 20000 per user, rate-limited). The UI shows the size of the user's own list, never how many matched. Turning the setting off keeps the list; "Clear the list" deletes it. No claim of address-book sync is made on the web.

## 11. Verification

State machine in `src/server/verification`: `NONE → SELFIE_SUBMITTED` (selfie uploaded) `→ UNDER_REVIEW → VERIFIED | REJECTED`. (`PHONE_VERIFIED` is a legacy value from SMS sign-in; nothing assigns it, existing rows were migrated to `NONE`, and Google sign-in never counts as verification.) `REJECTED` allows a retry after 24 h. `VerificationProvider` interface: `submit(userId, selfieKey, profilePhotoKeys) → { providerRef, status }` and `onWebhook(payload)`. Default implementation is `ManualReviewProvider`, which sets `UNDER_REVIEW` and leaves the decision to a moderator. The UI shows the prototype's screens driven by real status with two steps (selfie, review); Google sign-in confirms a Google account, not a phone and not the person, so there is no phone step and no step is auto-completed. The profile badge renders only for `VERIFIED`.

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

Lapse semantics (approved 2026-09-17, fail closed): when Plus expires with `invisibleMode = true`, the predicate's second branch fails, so the user is **not** exposed. They stay hidden from new discovery; existing matches and chats remain accessible. This grants nothing premium for free. A subscription expiry must never unexpectedly expose a privacy-sensitive profile. When the user returns, `getInvisibleModeState()` reports `{ enabled: true, effective: false, suspended: true }` and the UI shows a clear state, "Your Invisible Mode is still on.", with two actions: renew Thundi Plus, or turn Invisible Mode off and return to normal discovery. The lapse also creates an `ACCOUNT_NOTICE` notification. Turning the flag on as a Free user is refused by the action and leads to the Plus upgrade experience.

Invisible Mode and Community (approved 2026-09-17): Invisible Mode is a Discover rule only. It does not affect existing matches, conversations or Community participation (posting, commenting, reacting, being viewed under Community privacy rules), and Community can never make an Invisible Mode user discoverable or reveal their state (§14.8). The setting UI states this explicitly.

Settings surface (Phase 9): Invisible Mode is the "Only people I like" option of Privacy → Profile visibility (Plus tag). A Free user who selects it gets the Plus explanation and nothing is stored; the server action calls `setInvisibleMode`, which refuses without the entitlement, so a direct request cannot enable it. The option's explanation always carries the Community disclosure above. The suspended state (Plus lapsed, flag still on) is shown as a warning with "Renew Thundi Plus" and "Turn Invisible Mode off". `getMembership` (`src/server/entitlements/presentation.ts`) is the only subscription payload the browser receives: tier, plan name, period end, cancel flag, capability flags and plan names; never provider references, override reasons or prices while `isPlaceholderPrice` is set (the Membership page shows "Price TBA" and states that payments are not available).

### 12.6a Anti-abuse ceilings are not monetization

The 30-messages-per-minute ceiling (`MESSAGE_SPAM_CEILING`) and the OTP/upload rate limits are **safety rules**. They apply to every tier, Plus included, and are never presented as something an upgrade removes. The Free 9-minute cooldown is the only messaging rule that Plus lifts.

### 12.6b Configuration defaults confirmed 2026-09-17

Boosts: 2 per rolling 7-day window, 30-minute duration, no performance multiplier claims in copy. Pass resurfacing: 30 days, configurable via `PASS_TTL_MS`. Undo: no time limit (§12.7).

### 12.7 Undo (last Pass)

Plus only. `undoLastPass(actor)` locks the actor's most recent `Pass` (undone or not) and reverses it only if it is still eligible: it has not already been undone and no later `Like` exists. There is **no time-based expiry** (approved 2026-09-17); `UNDO.maxAgeMs` in `src/config/product.ts` is `null` and remains as a structural hook so a limit can be reintroduced in one line. It sets `undoneAt = now` and returns the profile so the client can put it back on top of the deck. Discovery excludes only passes with `undoneAt IS NULL`. Nothing is deleted, only the latest action can be reversed, and only once; arbitrary historical undo is impossible by construction.

### 12.8 Profile Boosts

Plus allowance 2 per rolling 7-day window, using the same `UsageCounter` mechanism with `kind = 'BOOSTS'` and a 7-day window (Free limit 0, so any Free activation is rejected). Activation inserts a `Boost (userId, startsAt, endsAt = startsAt + BOOST.durationMs)`. Only one boost may be active at a time. Discovery ordering places candidates with an active boost first; the weight and duration live in `src/config/product.ts`, not in query code. Copy never claims a multiplier: "Get seen sooner" / "Temporarily increase your visibility in discovery."

### 12.9 Advanced filters

Free: age range, show me, location (Anywhere / Greater Malé / My atoll / specific city), intention, as in the prototype. Plus adds: specific island or atoll selection, height range, education, and combined filters. Distance is deliberately absent and no coordinates exist in the model.

### 12.10 Plans, subscriptions and payments (as built in the Admin + Plus phase)

- `SubscriptionPlan` rows are admin-managed (`/admin/plans`, `src/server/billing/plans.ts`): free-form `code`, name, description, `intervalDays`, `priceMinor` (laari), currency (MVR), badge, sort order, `active` (enabled) and `isPlaceholderPrice`. A plan is **for sale** only when `active` and `isPlaceholderPrice = false` with a price above zero. Prices live in the database, never in components; `PLAN_CATALOG` in `src/config/product.ts` is only the development seed (placeholder prices, flagged). Every plan and payment-method change is audited with before/after.
- `PaymentMethod` rows (`/admin/payments/methods`, `src/server/billing/payment-methods.ts`): type `BANK_TRANSFER`, label, bank, account holder, account number, currency, optional instructions, `enabled`, sort order. Bank details exist only here. The enabled method with the lowest sort order is offered at checkout. The model takes more types (a gateway) without changing orders or subscriptions.
- `Subscription` rows are created only by the admin approval in §12.12 (`provider = manual_bank_transfer`, `orderId` unique) or, later, by a gateway webhook. No user-facing action creates or activates one. Tier resolution (§12.2) is unchanged and fails closed on `currentPeriodEnd > now`.
- Upsell UX is unchanged (calm in-context prompts, reading never blocked).

### 12.11 Buying Plus by bank transfer (customer side)

Flow: Membership → choose plan → order created → bank instructions → transfer → "I've made the transfer" → receipt upload → **Payment under review** → approved or rejected.

- `SubscriptionOrder` (`src/server/billing/orders.ts`) snapshots the commercial terms at creation: plan name, `amountMinor`, currency, `durationDays`, plus the payment method's label, bank, account holder, account number and instructions. Editing a plan or method later never changes an existing order (tested).
- **Reference**: `THU-` + six characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O/1/I), generated server-side with `crypto.randomInt`, unique by constraint, retried on collision. Random, so sales volume is not revealed. The customer puts it in the transfer remark.
- **One open order per customer** (advisory lock `order:<userId>`): asking again for the same plan returns the same order; asking for a different plan cancels an unpaid order and creates a new one; a SUBMITTED order is never replaced. Unpaid orders expire after 7 days (`ORDER_RULES.awaitingPaymentTtlMs`), lazily on every read. The customer may cancel only while AWAITING_PAYMENT.
- Eligibility: ACTIVE account with completed onboarding, a for-sale plan, an enabled payment method. Deleted, suspended and onboarding accounts are refused. The client sends only `planId`.
- **Receipt** (`/api/payments/<orderId>/receipt`, same-origin, session-owned): JPG/PNG/WebP up to 8 MB, sniffed and re-encoded to WebP with metadata dropped (`processImage`), stored in the private bucket under `payment-receipts/<userId>/<orderId>/receipt.webp`, 10 uploads per hour. The upload **is** the submission: AWAITING_PAYMENT → SUBMITTED in one step; submitting again is idempotent. The browser never sees the storage key, only 5-minute signed URLs, and only the owner and admins can obtain one. Uploading grants nothing.
- The order screen (`/settings/membership/order/<id>`) shows plan, amount, bank, holder, account number, reference and instructions with copy controls, states that Plus activates after confirmation, and then the review / approved / rejected states. A rejected order is final: the customer starts a new order (new reference). Rejected orders are kept.
- `getMembership` (§12.6) now carries the for-sale plans with prices, `paymentsAvailable` and the customer's current order; never storage keys, provider references or other people's data.

### 12.12 Admin review, activation, renewal and expiry

- State machine (`src/server/billing/state.ts`): `AWAITING_PAYMENT → SUBMITTED | CANCELLED | EXPIRED`, `SUBMITTED → APPROVED | REJECTED`; every other edge is refused server-side inside the transaction. The client never sends a status.
- **Approval** (`src/server/billing/approval.ts`, permission `payments.review`): one transaction that locks the order row (`FOR UPDATE`), takes the customer lock `sub:<userId>`, computes the period from the order snapshot, inserts the `Subscription` with `orderId` (unique) and `providerSubscriptionRef = order:<id>`, marks the order APPROVED with the deciding admin and time, writes a `PAYMENT_APPROVED` notification and the audit row. A second approval (double tap, refresh, another admin) waits on the row lock and then sees APPROVED, or hits the unique constraint; both return the same idempotent success and create nothing (tested with parallel transactions). An admin cannot approve their own order; a DELETED customer's order cannot be approved.
- **Period rule**: first purchase `start = approval time`, `end = start + durationDays`. Renewal while Plus is still active: `start = current paid end`, so early renewal never loses paid days. Two orders for one customer approved simultaneously chain correctly under the customer lock (tested).
- **Rejection**: reason required (3–300 chars), shown to the customer, `PAYMENT_REJECTED` notification, audit row; Plus is not activated; the record is kept.
- **Expiry** (`src/server/billing/expiry.ts`): `notifyExpiringSubscriptions` warns once 3 days before a customer's last paid period ends (`SUBSCRIPTION_EXPIRING`); `markExpiredSubscriptions` sets lapsed rows to EXPIRED and notifies once (`SUBSCRIPTION_EXPIRED`). No scheduler is installed yet; entitlement never depends on these because tier resolution compares `currentPeriodEnd` with `now`.
- Admin subscription adjustments (`/admin/subscriptions`, permission `subscriptions.adjust`) need a reason and write before/after dates to the audit log.

### 12.13 Concurrency guarantees, summarised

| Limit | Serialisation mechanism | Why it holds |
| --- | --- | --- |
| Likes per window | `SELECT ... FOR UPDATE` on the user's `UsageCounter` row inside the like transaction | Concurrent transactions queue on the row lock; each re-reads `used` after acquiring it. |
| Duplicate like | unique index `(fromUserId, toUserId)` | Second insert conflicts; treated as idempotent success without consuming quota. |
| Message cooldown | `pg_advisory_xact_lock` per sender + `MAX(createdAt)` check inside the transaction | Concurrent sends queue on the advisory lock; the second sees the first's committed row. |
| Boosts per window | same `UsageCounter` row lock, kind BOOSTS, plus a check for an already-active boost | as likes |
| Undo | row lock on the latest pass + "is latest action" check | Only one reversal can win; nothing else is mutated. |
| Mutual match | unique `(userAId, userBId)` with `ON CONFLICT DO NOTHING` | as section 8 |
| Payment approval | `SELECT … FOR UPDATE` on the order + advisory lock per customer + unique `Subscription.orderId` | Concurrent approvals serialise; the loser sees APPROVED (or the unique violation) and reports idempotent success. |
| One open order | advisory lock `order:<userId>` inside the create transaction | Two simultaneous "Get Plus" taps yield one order. |

All of these are covered by integration tests that fire parallel transactions against a real Postgres (section 17).

## 13. Notifications

Types: `NEW_MATCH`, `MESSAGE`, `LIKE_RECEIVED` (Plus users see who; free users get a count-only notification), `INTRO_RECEIVED`, `COMMUNITY_LIKE`, `COMMUNITY_COMMENT`, `VERIFICATION_UPDATE`, `SAFETY_NOTICE`, `ACCOUNT_NOTICE`, and the billing types `PAYMENT_APPROVED`, `PAYMENT_REJECTED`, `SUBSCRIPTION_EXPIRING`, `SUBSCRIPTION_EXPIRED` (§12.12; transactional, not gated by preferences). Notifications never control authorization: the entitlement service and the database are canonical. Created inside the same transaction as the triggering write. Read model returns unread counts per tab for badges; `markRead(actor, ids | all)`. `NotificationSettings` (matches, likes, messages, community, marketing) gate creation of the non-safety types. A `PushSubscription` table is included in the schema so Web Push can be added without migration; no push is sent in this phase.

Settings (Phase 9): the five categories are toggles in Settings → Notifications (`src/server/notifications/settings.ts`, partial updates, unknown keys stripped). Each writer already consults the recipient's row when raising a notification, so turning a category off stops future rows of that kind and leaves history intact (tested). Marketing has no sender yet and is stored only; nothing is pushed.

## 14. Community (as built in Phase 8)

Prototype behaviour reproduced: the Community tab (26/800 title; For You / Following / New pills; radius-24 post cards with 44 px avatar, 15/700 name + 14 px seal, "island · time" meta, 36 px ··· options, QUESTION tag, 16 px body, 240 px radius-18 photo, heart + count and comment bubble + count), the 54 px ocean FAB, and the "New post" sheet (Text / Photo / Question pills, 4-row textarea whose placeholder follows the kind, "Posting as {island} · Community posts don't create matches", 52 px ocean Post). Tapping the author avatar opens the full profile. The prototype has no thread screen, no Community nav badge, no follow feature, no image comments and no nested replies; its Share button has no behaviour and is not rendered.

14.1 Data model. The existing `CommunityPost` (kind TEXT | QUESTION | PHOTO, body, photoKey/photoBlurhash, likeCount, commentCount, deletedAt), `CommunityComment` (flat, soft delete), `CommunityLike` (primary key postId + userId), `Notification` (COMMUNITY_LIKE / COMMUNITY_COMMENT with actorId + postId) and `Report` (targetPostId) are reused. Migration `20260917200000_community_media_and_comment_reports` adds `CommunityPost.photoModeration` (PhotoModeration, default PENDING; text and question posts are stored APPROVED because only media is moderated) and `Report.targetCommentId` (+ index, RESTRICT) so comments can be reported with the same evidence snapshot. Counters are maintained in the same transaction as the like/comment write, recomputed from rows by the seed, and asserted equal to `count(*)` under concurrency in tests.

14.2 One visibility rule (`postVisibleSql`, used by feed, thread, reactions, comments and reports): not deleted; author ACTIVE and not deleted; no Block in either direction and no contact block (`noBlockOrContactSql`, shared with Discover); photo posts only when the media state is displayable under the photo visibility policy (§7.1) or the viewer is the author. Anything invisible reads as NotFound, never Forbidden. Comments hide by the same rule (deleted, blocked pair, non-active author). Suspended or deleted authors disappear with their content.

14.3 Feed and ranking. For You = every visible post, newest first. New = the last 24 hours, newest first. Following = explanatory empty state (the product has no follow feature). No engagement ranking. Pagination is keyset on `(createdAt DESC, id DESC)` with an opaque base64url cursor (`createdAt|id`), page size 12 (bounded at 50), `LIMIT n + 1` to derive `nextCursor`; stable under concurrent inserts and deletes. A page costs three queries — ids, posts plus the viewer's likes, authors in one `IN` query — so there is no N+1. Nothing personalised is cached: `force-dynamic` pages and cookie-scoped server actions.

14.4 Safe DTOs (`src/server/community/dto.ts`). Author: handle, display name, verified flag, first displayable photo (signed URL or demo key, blurhash), island label or null when `hideLocation`, `isMe`. Post: id, kind, body, photo | null, `photoUnderReview` (author only), likeCount, commentCount, likedByMe, createdAt, author, isMine. Comment: id, body, createdAt, author, isMine. Never: phone, DOB or age, precise location, contact hashes, internal user ids, subscription, moderation or report data, session data. A test pins the exact key set.

14.5 Posting and media. `createPost` requires ACTIVE status, validates kind and body server-side (control characters stripped, 1–1000 characters, HTML kept as text and rendered as text by React), applies an anti-abuse ceiling (10 posts per hour per user via `consumeRateLimit`), and for photos runs `processImage` (sharp: format sniffed from bytes, JPEG/PNG/WebP only, ≤ 8 MB, ≥ 400 px, EXIF orientation applied, re-encoded to WebP so metadata is stripped, blurhash computed) then stores `community-photos/<userId>/<postId>/full.webp` through the storage abstraction and marks the post PENDING. Uploads go through `POST /api/community/posts` (multipart for progress; same-origin check; 401/413/422/409 mapping). The moderation policy is the central photo policy: development shows PENDING, production shows APPROVED only, so production never silently publishes an unreviewed photo — the author sees "Photo under review" and nobody else sees the post until it is approved (the same launch requirement as §7.1). Only the author can delete (soft delete; related notifications are marked read).

14.6 Reactions and comments. One heart per user per post: `INSERT … ON CONFLICT DO NOTHING` / `DELETE`, the counter changes only when a row changed, ceiling 60 per minute. Comments are flat (no nesting), 1–500 characters, oldest first, keyset paginated (30), ceiling 20 per minute, author-only soft delete with counter decrement. Likes and comments are optimistic in the UI and reconciled with the server response; a failed or offline call rolls back and shows a toast. The thread header shows the number of comments the viewer can see once the thread is fully loaded (blocked authors' comments are filtered), otherwise the public counter.

14.7 Report and block. Reporting a post or comment stores a `Report` with the approved reason, the target user resolved server-side and a content snapshot; it does NOT block the author (the prototype separates ··· → Report from Block, and Phase 7's conversation report keeps its approved report-and-block behaviour). The report confirmation says so and offers "Also block" as an explicit second step; Block is also a direct menu item with its own confirmation. Blocking uses the shared `blockUser` (pairwise, closes any match/conversation) and hides posts, comments and profiles in both directions immediately. Own content gets Delete only. Reporting own content is refused.

14.8 Dating boundary. Community never creates Like, Match or Conversation rows and offers no message action. The author overlay is the read-only full profile via `getCommunityProfile`: visible when the author is ACTIVE and not blocked either way (contact blocks included); hidden age/location and the photo policy are applied; the Discover eligibility predicate is deliberately not applied, so Community does not reveal who is discoverable. No Like/Pass controls: a dating Like must go through the Phase 6 path and its caps (Free 30 / Plus 90). Invisible Mode (owner decision, approved 2026-09-17, `COMMUNITY.invisibleModeParticipation = "ALLOWED"`): Invisible Mode controls dating-discovery visibility only. An Invisible Mode user may view Community, post, comment, react and have their Community profile and content viewed under the normal Community privacy rules; none of that makes them eligible for or visible in Discover unless the Phase 6 rules independently allow it, and Community never reveals dating eligibility, discovery preferences, likes or the Invisible Mode state. The Invisible Mode setting discloses: "Invisible Mode hides you from Discover. Your Community posts and comments can still be visible to other Community members." Regression-tested in `community.test.ts`. (`READ_ONLY` remains a one-line switch that hides the composer and rejects posts server-side, unused.)

14.9 Notifications. `COMMUNITY_LIKE` and `COMMUNITY_COMMENT` rows are created in the same transaction as the write, only when the recipient has `notificationSettings.community` on, never for one's own actions or across a block, and de-duplicated per (type, post, actor) while unread. No push. No Community badge in the nav (the prototype has none).

14.10 Limits (`COMMUNITY` in `src/config/product.ts`): post 1000 characters, comment 500, feed page 12, comments page 30, New window 24 h, 10 posts/hour, 20 comments/minute, 60 reactions/minute.

## 21. Admin dashboard and roles (as built in the Admin + Plus phase)

### 21.1 Authorization

`User.role` (`USER | MODERATOR | ADMIN`) on the canonical account row is the only source of admin authority. It is read from the database on every request through the session lookup; Google confirms the person and never confers a role. `src/server/admin/authz.ts` exposes `getAdminActor()` (null for anyone who is not an ACTIVE, onboarded admin), `requireAdminPage(permission?)` for pages and layouts (non-admins get the same 404 as a missing page: NotFound, never Forbidden) and `requireAdmin(permission?)` for server actions and route handlers (throws; mapped to a generic failure). Every admin mutation calls `requireAdmin` itself and the domain functions additionally call `assertPermission`, so a client can neither forge a role nor reach a domain function without one. Permissions (`src/server/admin/permissions.ts`, pure): ADMIN has all; MODERATOR has `dashboard.view`, `users.view`, `users.moderate`, `reports.act`, `verification.act` only. Navigation is filtered by role for tidiness; it is not the control.

Routes: `/admin` (dashboard), `/admin/users`, `/admin/users/[userId]`, `/admin/payments`, `/admin/payments/[orderId]`, `/admin/payments/methods`, `/admin/plans`, `/admin/subscriptions`, `/admin/reports`, `/admin/reports/[reportId]`, `/admin/verifications`, `/admin/audit`, all under the guarding layout; `/admin-setup` (bootstrap) is outside it. Admin DTOs never include session tokens, OAuth material, phone numbers, contact hashes, storage keys or provider refs (tested).

### 21.2 First administrator (bootstrap)

No email is hard-coded, nobody becomes admin automatically, and there is no public "become admin" action. Two audited paths:

1. `ADMIN_BOOTSTRAP_TOKEN` (32+ random characters) in the server environment + `/admin-setup`: a signed-in, onboarded user presents the token; the claim succeeds only while **no** admin exists (checked under the `admin:roles` lock), is rate-limited (5/hour/user), compared in constant time, and writes `admin.bootstrapped`. The page is a 404 whenever bootstrap is unavailable. The owner removes the variable afterwards.
2. `scripts/grant-admin.ts --email <google email> | --user-id <id> [--role …]` for an operator with database access; writes `admin.role.changed` with `via: cli`.

Later role changes happen in the user detail screen (ADMIN only, reason required, never your own role, never the last admin).

### 21.3 Dashboard metrics

`src/server/admin/metrics.ts` computes every figure from canonical rows at request time; nothing is stored. Definitions are shown in the UI (`METRIC_DEFINITIONS`). "Today" is the Maldives calendar day (UTC+5); 7- and 30-day figures are rolling. There is no activity tracking, so the closest figure to "active users" is "Signed in, 7/30 days" (`User.lastActiveAt`, set at Google sign-in) and it is labelled as such.

### 21.4 Users and account actions

Search by public name, handle or internal id with account-state, onboarding, verification, membership and joined-date filters. Detail shows account, sign-in email, profile summary, privacy flags, verification, membership and subscriptions, orders, safety counts and the audit history for that account. Actions: suspend (from ACTIVE/ONBOARDING; sessions deleted), unsuspend (back to ACTIVE or ONBOARDING), ban (sessions deleted), change role (ADMIN only). Each needs a reason and writes before/after to the audit log. Rules: never yourself; moderators act on USER accounts only; admins on USER and MODERATOR accounts (change the role first for an admin); DELETED accounts are untouchable. There is no impersonation or "log in as user".

### 21.5 Moderation and verification queues

Reports reuse the §10 rows and evidence (reason, note, message snapshot). Decisions `OPEN → UNDER_REVIEW | RESOLVED | DISMISSED`, `UNDER_REVIEW → RESOLVED | DISMISSED`; resolving requires a resolution note; every decision is audited; account actions are taken from the target's page. The verification queue lists `SELFIE_SUBMITTED`/`UNDER_REVIEW` rows; a decision requires a submitted selfie (`selfieStorageKey`), so nobody can be marked VERIFIED without evidence; the selfie upload step itself is still pending (§11) and the UI says so. Google sign-in is never evidence.

### 21.6 Audit log

`src/server/admin/audit.ts` is the single writer. Actions: `admin.role.changed`, `admin.bootstrapped`, `user.suspended`, `user.unsuspended`, `user.banned`, `report.decided`, `verification.decided`, `payment.approved`, `payment.rejected`, `subscription.adjusted`, `payment_method.created/updated`, `plan.created/updated` (plus the existing user-initiated `account.deleted` / `account.recreated`). Payloads are sanitised: keys that look like secrets (token, hash, secret, providerSubject, …) are dropped before writing; account numbers are logged as last four digits. `/admin/audit` is read-only and no admin surface can edit or delete rows.

## 15. Security controls summary

| Threat | Control |
| --- | --- |
| IDOR on profiles, conversations, photos, posts | Actor derived from session; every read model filters by actor; opaque ids; NotFound instead of Forbidden. |
| Forged user ids in payloads | Zod schemas do not accept `userId`; domain functions take `actor`. |
| Duplicate likes / matches | Unique constraints plus `ON CONFLICT` inside one transaction. |
| Sign-in forgery / replay | Google OIDC only: PKCE (S256), signed state cookie (constant-time compare), nonce bound to the ID token, RS256 signature against Google's JWKS, issuer/audience/expiry checks, `email_verified` required, no `alg:none`; ten-minute flow cookies; failures reveal nothing about accounts. |
| Session theft | HttpOnly Secure cookie, hashed token at rest, idle and absolute expiry, logout-everywhere; destructive actions additionally need a five-minute-fresh Google re-authentication bound to the same session and identity (`reauthenticatedAt`, consumed on use). |
| XSS | React escaping; no `dangerouslySetInnerHTML` (the only inline script is the static theme initialiser); names and bios refuse `<`/`>` and control characters; CSP with nonces scheduled for Phase 12. |
| CSRF | Server actions same-origin; mutating route handlers check `Sec-Fetch-Site`/`Origin`; webhooks verify signatures. |
| Malicious uploads | Session + same-origin check, size cap, MIME sniffing with `sharp`, minimum dimensions, re-encode, metadata strip, private bucket / signed local route, server-produced variants only. |
| Enumeration | Sign-in creates or resumes without saying which; opaque handles; rate limits on lookup endpoints. |
| Spam | Message and post rate limits, daily like cap for free users, report pipeline. |
| Secret exposure | `env.ts` splits server/public; only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public; the secret key never leaves the server. |
| Minor access | DOB required, server-side age check when the date is saved and again on onboarding completion (a tampered row is refused); no DOB write path outside onboarding. |
| Privilege escalation | `role` and `Subscription` are not writable by any user-facing action. |
| Evidence destruction | Soft deletes for messages, posts, matches; report snapshots; account deletion anonymises and keeps reports, blocks, message history and the audit log. |

## 16. Environment variables

`.env.example` is the reference (kept current). Summary:

```
DATABASE_URL=            # pooled, transaction mode, ?pgbouncer=true&connection_limit=5
DIRECT_DATABASE_URL=     # session pooler or direct; used by prisma migrate/seed
TEST_DATABASE_URL=       # server on which the test run creates a throwaway database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_...
SUPABASE_SECRET_KEY=                    # sb_secret_... server only; required when STORAGE_PROVIDER=supabase
SUPABASE_STORAGE_BUCKET_PHOTOS=profile-photos   # private bucket, must exist before switching the provider
SESSION_SECRET=          # 32+ bytes: HMAC for the OAuth flow cookies, dev identity provider and local media URLs
CONTACT_HASH_SALT=       # 32+ bytes, see CONTACT_BLOCKING.md (public salt, delivered to signed-in clients)
AUTH_PROVIDER=dev        # dev (local stand-in identity provider; refused in production) | google (default and only value in production)
GOOGLE_CLIENT_ID=        # required with AUTH_PROVIDER=google; redirect URI ${APP_URL}/auth/google/callback
GOOGLE_CLIENT_SECRET=    # server only
ADMIN_BOOTSTRAP_TOKEN=   # optional, one-time: first-admin claim at /admin-setup while no admin exists (§21.2); remove after use
STORAGE_PROVIDER=local   # local (dev/test) | supabase
LOCAL_STORAGE_DIR=.storage
PAYMENT_PROVIDER=none
VERIFICATION_PROVIDER=manual
APP_URL=http://localhost:3000
```

`src/lib/env.ts` validates all of this with Zod at first use and refuses a production boot with `AUTH_PROVIDER=dev`, a missing Google client, or `STORAGE_PROVIDER=local`. `OTP_PEPPER`, `SMS_PROVIDER` and `THUNDI_DEV_OTP_ECHO` no longer exist. Supabase now issues `sb_publishable_*` and `sb_secret_*` keys; the legacy `anon`/`service_role` keys still work until end of 2026 but the code uses the new names.

## 17. Testing strategy

- Unit (Vitest): age calculation across time zones and leap days, phone normalisation, OTP hashing and attempt rules, entitlement derivation, completion percentage, intro week keys.
- Integration (Vitest against Postgres): under-18 rejection at onboarding completion; duplicate like idempotency; mutual like creates exactly one match under concurrency (two parallel transactions); blocked users excluded from deck, likes-you and chat; conversation and message authorization for non-participants; intro quota per week; report creation with snapshot; privacy filtering (hidden location/age, hidden visibility); premium checks for likes-you and advanced filters.
- Monetization (Vitest against Postgres, required): Free allowance is 30 and Plus 90; like consumes, pass does not; 30th succeeds and 31st is rejected with `resetsAt`; allowance restores after the 24-hour window; session/device changes do not reset it; N concurrent likes with one remaining yield exactly one success; expiry of Plus returns the user to Free limits. Messaging: matched Free user sends, immediate second send rejected, allowed after 9 minutes, cooldown spans conversations, receiving/reading unaffected, Plus has no cooldown, direct calls during cooldown rejected, simultaneous sends yield one success. Invisible Mode: normal discoverability, hidden from non-liked users, visible after liking, matches unaffected, lapsed Plus fails closed. Likes You: Free receives no identifying fields, Plus receives profiles. Boosts: Plus allowance 2 per 7 days, window enforced, Free rejected.
- Authentication and onboarding (Vitest): ID-token verification against a fake Google JWKS (valid token; wrong issuer, audience, expiry, nonce, unverified email, unknown kid, tampered payload, HS256/none algorithms rejected); authorization request carries PKCE S256, state, nonce and scopes and the exchange posts the verifier and secret; the dev identity provider's codes are bound to redirect URI, nonce and PKCE and expire; production refuses the dev provider and requires the Google client; first sign-in creates one ONBOARDING account with verification NONE and no phone, returning sign-ins map to the same `User.id`, concurrent first sign-ins converge, suspended/banned get no session; deleted accounts are told and only an explicit choice creates a new `User.id` (old row untouched, identity moved, refused when not deleted); recent authentication marks only the requesting session and identity, expires, and is consumed once; deletion refuses without it; users without a phone are discoverable, can view, post and like, and contact blocking still applies through existing lists; session hashing, expiry, revoke one/all; onboarding persistence and resume, exactly-18 accepted and 17y364d refused, DOB absent from public DTOs, required-field gate; photo pipeline rules.
- E2E (Playwright, dev identity provider, scripted outside the repo for now): the full sign-up journey through Continue with Google, forged under-age submission, refresh and forward-jump mid-onboarding, logout and re-login resuming the exact stage, upload errors with retry, reorder/remove, completion to Discover, and every route guard; screenshots at 375/390/430/1280 in light and dark.
- CI: typecheck, lint, unit + integration on a Postgres service container, production build.

## 18. Delivery plan mapping

| Phase | Output |
| --- | --- |
| 3 Database (done) | `prisma/schema.prisma`, migration `20260917152844_init`, seed (reference + dev-only demo data), `src/lib/db.ts`, `prisma.config.ts`, plus the monetization domain layer (`src/config/product.ts`, `src/server/{entitlements,usage,discovery,likes,matching,conversations,boosts,privacy}`) and its database-backed tests. Applied to the hosted Supabase project on 2026-09-17 together with the later migrations (`docs/DEPLOYMENT.md` §3). |
| 4 Design system (done) | `tokens.css`, Tailwind theme, `components/ui/*`, layout shell, preview route `/dev/design-system` in development only. |
| 7 Messaging (done) | `src/server/conversations/{messages,list,unmatch,profile}.ts`, `src/server/safety/report.ts`, `src/actions/messaging.ts`, Chats list, split layout, conversation screen (composer, cooldown, polling, options/report/block/unmatch sheets), badges from read state, 14 new tests. No migration needed. |
| 6 Discovery + likes + matching (done) | `src/server/discovery/{predicate,query,dto,deck,filters}.ts`, `src/server/locks.ts`, `src/server/safety/block.ts`, hardened `likes/like.ts` and `matching/match.ts`, `src/actions/discovery.ts`, Discover client (deck, filters sheet, full profile, match overlay, like-limit dialog, empty states), `/chats/[conversationId]` shell, development discovery scenarios in the seed, 23 new tests. No migration needed. |
| 5 Auth + onboarding (done) | Migration `20260917170000_onboarding_stage_otp_phone`, `src/server/auth/*`, `src/server/onboarding/*`, `src/server/photos/*`, `src/lib/storage/*`, `src/lib/env.ts`, `proxy.ts`, server actions in `src/actions/*`, routes `/auth/*`, `/onboarding/[stage]`, `/api/photos`, `/api/media`, onboarding and auth components, tests. Hosted Supabase migrated and the private `profile-photos` bucket created with owner approval (`docs/DEPLOYMENT.md`). |
| 8 Community (done) | Migration `20260917200000_community_media_and_comment_reports`, `src/server/community/{dto,feed,posts,reactions,comments,reports,notify,profile}.ts`, `src/server/media/process-image.ts`, `src/actions/community.ts`, `POST /api/community/posts`, Community feed, compose sheet, thread route `/community/[postId]`, safety menus, profile overlay, dev scenario posts in the seed, 12 new tests. |
| 10 Likes You + intros | Likes You grids (Free anonymised / Plus full), intros, Matches tab. |
| 9a Google-only authentication (done) | Migration `20260917230000_google_auth` (AuthIdentity, Session.reauthenticatedAt, optional phone, OtpRequest dropped, PHONE_VERIFIED → NONE), `src/server/auth/{jwt,oidc,identity,recent-auth}.ts`, `src/lib/oauth-cookie.ts`, `/auth/google/{start,callback}`, `/auth/deleted`, `/auth/error`, dev identity provider under `/dev/google`, deletion via Google re-authentication, seeded dev identities, 11 new tests. SMS OTP code, routes, actions and env removed; phone normalisation and hashing kept for contact blocking. |
| 9 Profile, settings, privacy & safety (done) | `src/server/profiles/edit.ts`, photo minimum rule, `src/server/privacy/{settings,contact-hashes}.ts`, `src/server/safety/blocked.ts`, `src/server/notifications/settings.ts`, `src/server/entitlements/presentation.ts`, `src/server/users/deletion.ts`, `verifyOtpCode`, actions `profile/settings/account`, routes `/profile/edit`, `/profile/preview`, `/settings`, `/settings/{privacy,blocked,membership,safety,verification,discovery}`, shared `PhotoManager`, Pause Dating enforcement in likes and deck, 20 new tests (177 total). No migration needed. |
| 11 Admin dashboard + Plus subscriptions (done) | Migration `20260918030000_admin_billing` (plans as admin-managed rows, `PaymentMethod`, `SubscriptionOrder`, `Subscription.orderId`, billing notification types), `src/server/admin/*`, `src/server/billing/*`, actions `admin`/`billing`, `/api/payments/[orderId]/receipt`, `/admin/**` (dashboard, users, payments, methods, plans, subscriptions, reports, verifications, audit), `/admin-setup`, Membership purchase flow and order screen, `scripts/grant-admin.ts`, 38 new tests (209 total). Selfie verification workflow still pending (§11). |
| 12 Hardening | Tests, CSP, rate limits review, build, security review. |

## 19. Decisions taken without asking (reversible)

- Own session/OTP layer instead of Supabase Auth.
- Polling before Realtime.
- Blurred likes are pre-blurred server-side rather than CSS-blurred (CSS blur leaks the real image).
- Passed profiles resurface after 30 days.
- Invisible Mode fails closed on Plus lapse (user stays hidden rather than being exposed), see 12.6.
- Undo has no time window (approved after Phase 3); boost duration of 30 minutes is a configuration default.
- The prototype's on-screen OTP keypad is replaced by the device keyboard (numeric input mode, one-time-code autofill, paste), see DESIGN_SYSTEM.md §12.
- The prototype's onboarding "Only people I like" free option is shown on the privacy step as the Plus-only Invisible Mode (mentioned, not offered); the free controls remain Hide my location and Hide my age.
- The prototype's free "Only people I like" visibility option is folded into the Plus-only Invisible Mode, per the approved monetization rules.
- Community "Following" tab ships as an explanatory empty state rather than being removed.
- Community reports do not block the author (the prototype separates Report and Block); the report confirmation offers Block as a second step. Conversation reports keep their approved report-and-block behaviour.
- A Community thread route (`/community/[postId]`) exists so comment counts lead somewhere; the prototype only shows counts. The prototype's no-op Share button is omitted.
- Text and question posts are stored with `photoModeration = APPROVED` (only media is moderated).
- Phase 9: Name and date of birth are read-only in Edit profile (prototype rows are read-only; a DOB change would also let a verified age be altered), so no DOB write path exists outside onboarding. Prototype toggles with no product behaviour (Read receipts, Profile sharing, a second "Incognito mode" switch) are not offered; Email ("Hidden from others") is omitted because the product has no email. Terms, Privacy Policy and Report a Problem rows read "Not yet available" rather than acting as links. The Safety Center's support card says the support inbox is not connected instead of showing a dead "Message support" button; 119 (Maldives Police) is kept. The Membership page lists the approved entitlements, not the prototype's older perk list, and shows no price while pricing is unapproved. A "Discovery preferences" page was added under Settings so the Phase 6 filters are reachable outside Discover. "Replay onboarding" (a prototype dev shortcut) is not reproduced.
- Google-auth migration: the welcome screen's two prototype buttons ("Get started" / "I already have an account") collapse into one "Continue with Google", because sign-up and sign-in are the same action; onboarding steps renumber to 1–11. A local development identity provider (`AUTH_PROVIDER=dev`) stands in for Google so the flow can run and be tested offline; it is refused in production. Deleted accounts keep their scrubbed identity row (Google `sub` only) so the same Google account is told about the deletion instead of being silently re-registered; re-registration is an explicit choice that creates a new `User`. Re-authentication uses `prompt=select_account` plus `login_hint` and verifies the same `sub`; Google decides whether to ask for the password again (its `max_age` handling is not documented), so freshness is enforced by our five-minute window rather than by Google's `auth_time`.
- TypeScript pinned to 5.9 rather than 7.0.

## 20. Open items needing the owner

- Staging is deployed (`docs/DEPLOYMENT.md`): Vercel project `thundi` at `https://thundi.vercel.app`, Supabase project `qkubuaicuyoaskzcabcu` migrated through `20260917230000_google_auth`, reference data loaded, RLS enabled, private bucket `profile-photos` created, and the Google OAuth client registered for that origin. Still needed before launch: a paid Vercel plan and custom domain (the Hobby plan is non-commercial), and the redirect URI `${APP_URL}/auth/google/callback` registered for each additional environment.
- Verified phone (optional): sign-in no longer verifies a phone. If the product wants "phone verified" as an independent signal (or wants people to hide from contacts through their own number), an explicit phone step with its own SMS provider decision is needed; nothing is assumed meanwhile.
- Photo moderation before launch: production shows APPROVED photos only (§7.1). Either the moderation/approval workflow (Phase 12) must exist so uploads become APPROVED, or the owner must approve an alternative photo policy. Without one of these, new users will not be discoverable in production.
- Account deletion retention (Phase 9, Google-auth migration): deletion anonymises immediately but keeps the anonymised User row, message history, reports, blocks, subscription records and the scrubbed identity row (Google subject only, so a returning Google account is told its account was deleted) indefinitely because no legal retention period has been decided. The owner (with legal advice) must set how long those records are kept before a purge job is written; no duration was invented.
- **Hosted migration `20260918030000_admin_billing`** must be applied to the Supabase project (approved process: owner approval, then `docs/DEPLOYMENT.md` §3) before the admin and Membership purchase screens work on staging. Until then those routes fail on the hosted database; sign-in, Discover, chats and Community are unaffected.
- **First administrator**: set `ADMIN_BOOTSTRAP_TOKEN` (32+ random characters) in the Vercel Production environment, redeploy, open `/admin-setup` signed in as the owner, enter the token, then remove the variable (§21.2). Alternative: `npx tsx scripts/grant-admin.ts --email <google email>` with database access.
- **Plus prices and bank account**: no prices or bank details exist in code. In `/admin/plans` set the MVR price, switch on "Price approved" and enable each plan to sell; in `/admin/payments/methods` add the bank account and enable it. Nothing is for sale until both are done.
- Automated payment gateway for MVR (BML or equivalent) later: implement a provider that creates a `Subscription` the way `approveOrder` does; orders, plans and entitlements stay as they are.
- Admin-side expiry job: `notifyExpiringSubscriptions` / `markExpiredSubscriptions` exist but nothing schedules them yet (a Vercel cron or similar needs owner approval).
