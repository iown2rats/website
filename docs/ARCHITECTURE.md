# Mellocrush — Architecture (Phase 2)

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

### 4.1 Sign-in: Google or Telegram, both OpenID Connect (Google built after Phase 9; Telegram added 2026-09-18)

Authentication is "Continue with Google" or "Continue with Telegram" and nothing else: no SMS OTP, no email code, no password, no hidden fallback. The provider authenticates the person; **`User.id` remains the canonical identity** for every relation (profile, photos, likes, passes, matches, conversations, messages, Community, blocks, reports, settings, subscriptions, audit). Providers are authentication, not our relational identity, and **they are never linked to each other automatically**: the same person signing in with Google and with Telegram has two accounts unless a future explicit linking step (while signed in) says otherwise. Nothing matches on names, usernames or emails.

**Telegram (OpenID Connect, `TelegramOidcProvider`)**: Telegram's OIDC service at issuer `https://oauth.telegram.org` (authorization `/auth`, token `/token`, JWKS `/.well-known/jwks.json`; endpoints pinned in code rather than read from discovery, so a discovery outage or tampered document cannot move the flow). Configured in BotFather → the bot → **Login Widget**: Client ID, Client Secret (separate from the bot token; server-side only as `TELEGRAM_CLIENT_SECRET`), Redirect URIs (exactly `https://www.mellocrush.com/auth/telegram/callback`) and Trusted Origins (`https://www.mellocrush.com`, `https://mellocrush.com`). Scope `openid profile` only; the phone scope is not requested. The token endpoint is called with HTTP Basic client authentication (RFC 6749 §2.3.1) plus the PKCE verifier; the secret never appears in a URL or request body. ID tokens are RS256 (BotFather's default; the app rejects every other algorithm, so do not change it under Login Widget → Advanced). There is no userinfo endpoint and no email claim: `sub` (the Telegram user id) is the identity key, `name` / `given_name` / `family_name` the display name, `preferred_username` the @username when the person has one (stored as `AuthIdentity.providerUsername` for display in Settings and admin, never for matching). `AuthIdentity.email` is therefore nullable. Routes `/auth/telegram/start` and `/auth/telegram/callback` return 404, and the welcome screen hides the Telegram button, unless `TELEGRAM_CLIENT_ID` and `TELEGRAM_CLIENT_SECRET` are both set **and** the database carries the `TELEGRAM` enum value (`src/server/auth/telegram-availability.ts`: one cached `pg_enum` lookup, re-checked every minute while negative), so a deployment that ships the code and variables before the hosted migration never shows a button whose sign-in would fail, and Google keeps working throughout. The flow below is shared by both providers (`src/server/auth/flow.ts`); the pending-auth cookie records which provider started the flow and the other provider's callback refuses it.

- **Flow** (`/auth/<provider>/start` → provider → `/auth/<provider>/callback`, route handlers over `src/server/auth/flow.ts`): authorization-code flow with PKCE (S256), a random `state` and `nonce`. Provider, state, nonce and the PKCE verifier live in a signed HttpOnly cookie (`thundi_oauth`, 10 minutes, `src/lib/oauth-cookie.ts`). The callback compares the state in constant time, checks the cookie was issued for this provider, exchanges the code with the verifier and client secret at the provider's token endpoint, and verifies the ID token: RS256 signature against the provider's JWKS (cached, refreshed once on an unknown `kid`), issuer (`https://accounts.google.com` / `accounts.google.com`, or `https://oauth.telegram.org`), audience (our client id for that provider), expiry, nonce, subject, and for Google `email_verified`. Only `alg: RS256` (Google, Telegram) or `HS256` (dev stand-in) is accepted; `none`, `ES256` and `EdDSA` are rejected. Code: `src/server/auth/{jwt,oidc,flow}.ts`.
- **Mapping** (`src/server/auth/identity.ts`): `AuthIdentity (provider, providerSubject)` → `User`. The key is the provider's stable `sub` (Google subject, Telegram user id), never an email, name or username. Unknown subject → a new ONBOARDING account with every settings row and `Verification.status = NONE`, created race-safely (concurrent first sign-ins converge on one account, tested for both providers). Known subject → the same `User.id` every time; email, display name and username refresh from the token. SUSPENDED/BANNED → no session. DELETED → §4.4. Re-authentication for destructive actions is bound to the same provider **and** subject: a Google token for the same user, or a Telegram token for someone else, never marks the session (tested).
- **What Google does not prove**: control of a phone number or the person's identity for dating. Nothing sets `PHONE_VERIFIED` any more (existing rows were migrated to `NONE`; the enum value is legacy), the Verification screen has no phone step, and sign-in never grants the verified seal. Selfie/profile verification stays a separate workflow (§11).
- **Phone as optional data**: `User.phoneE164` / `phoneHash` are now nullable. They are profile / contact-blocking data (docs/CONTACT_BLOCKING.md), not credentials. A user without a phone is fully functional; contact blocking still applies through their own hidden list, while nobody can hide from them through a number they never provided (tested). Adding a phone in Settings is future work; `normalizeMaldivianPhone`, `maskPhone` and `hashPhone` remain for that and for contact hashing.
- **Provider abstraction**: `OidcProvider` with `GoogleOidcProvider` and `TelegramOidcProvider` (production, sharing an RS256 + JWKS base) and `DevOidcProvider` (`AUTH_PROVIDER=dev`, development and tests only; one instance per provider shape). The dev provider is a local stand-in for the provider's consent screen (`/dev/google/authorize`, with `?provider=telegram` for the Telegram shape, 404 in production) that issues its own signed codes bound to redirect URI, nonce and PKCE challenge and mints HS256 ID tokens under a per-shape issuer; the Telegram shape mints no email and a `preferred_username`, like the real thing, so the no-email path is exercised locally. The app's start/callback code is identical in both modes. Production requires `AUTH_PROVIDER=google` with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; Telegram additionally needs `TELEGRAM_CLIENT_ID` / `TELEGRAM_CLIENT_SECRET` together (one without the other is a configuration error); `src/lib/env.ts` refuses a production boot with the dev provider or without the Google client (tested). Redirect URIs: `${APP_URL}/auth/google/callback` on the Google OAuth client and `${APP_URL}/auth/telegram/callback` in BotFather (§20).
- **Failures** land on `/auth/error?reason=…&provider=…` (cancelled, state, token, session, identity, unavailable, provider) with no account detail; the screen names the provider that failed and offers that provider's button; enumeration is not possible because sign-in creates or resumes without ever saying which.
- **Existing accounts**: Google accounts are untouched by the Telegram addition (the migration is additive: an enum value, a nullable email, a nullable username column). The hosted database has never been migrated from phone auth, so no real phone-authenticated users exist. Development demo accounts receive an explicit seeded identity per demo key (`dev-<key>`, `<key>@demo.thundi.dev`) — a mapping defined by the seed, never guessed from names; their demo phones stay as optional contact-blocking data. Any other locally created phone-only account has no identity and simply cannot sign in (nothing is merged or deleted); if real phone-only users ever existed, the safe path would be an in-app "link your Google account" step while signed in, not an automatic merge.

### 4.1b Sign-in: email and password (added 2026-09-18; not exposed in production until §20 is cleared)

The third method, beside Google and Telegram, using the same identity model rather than a parallel system: one
`AuthIdentity` row with `provider = EMAIL`, `providerSubject` = the normalised address (this provider's natural stable
key), `email` the same value, `emailVerified` starting false, and `passwordHash` holding the verifier. Sessions,
onboarding, deletion and re-authentication are the existing ones.

- **Passwords** (`src/server/auth/password.ts`): scrypt from Node's own crypto, N = 2^16, r = 8, p = 1 (64 MiB), a
  16-byte random salt per password, stored as `scrypt$N$r$p$salt$hash`. Plaintext is never stored, logged or
  returned. Because each verifier carries its parameters, the cost can be raised later without invalidating anyone:
  `verifyPassword` reports `needsRehash` and sign-in re-hashes transparently; a future Argon2id implementation adds a
  prefix behind the same interface. Rules are NIST-style: at least 10 characters, a maximum of 200, and a refusal of
  one repeated character, a keyboard sequence and a short list of breach-corpus passwords. No character classes.
- **Tokens** (`src/server/auth/auth-tokens.ts`, table `AuthToken`): 32 random bytes, base64url. Only the SHA-256 is
  stored, so a leaked table cannot be replayed as a link. Single-use (a conditional `UPDATE` on `consumedAt`, so two
  clicks race safely and one wins), expiring (verification 24 hours, reset 60 minutes), and issuing a token consumes
  the identity's outstanding tokens of that purpose so only the newest link works. A verification token records the
  address it confirms, so a link sent to a previous address cannot confirm a new one.
- **Registration** → an account in ONBOARDING whose address is unverified, plus the verification email. The account is
  signed in immediately so it lands on the verification screen rather than a dead end. The entry point is the welcome
  card itself, which switches between signing in and creating an account in place (DESIGN_SYSTEM §27); `/auth/register`
  opens the same card already in register mode.
- **The unverified restriction** is enforced in one place, not in the UI. `resolveSession` selects whether the user has
  an unverified EMAIL identity, `authKindForUser` returns `"unverified"` for it, and from there: `resolveAccess` allows
  only `/auth/verify-email` (everything else, including onboarding and `/admin`, redirects there or 404s), and
  **`requireActor()` throws `EmailVerificationRequiredError`**, which is what actually closes discovery, likes,
  matches, messages, Likes You, Boost, Community, posts, comments and Plus — every server action goes through it. The
  verification screen's own three actions use `requireUnverifiedActor()`, which accepts nothing else.
- **Enumeration**: registration, sign-in and "forgot password" answer identically whatever the address is. A duplicate
  registration returns the same result and emails the address's real owner instead; a wrong password and an unknown
  address share one message; "forgot password" always reports success, even when rate-limited, because a different
  answer would itself separate addresses.
- **Rate limits** (Postgres buckets, `EMAIL_AUTH_RULES`): registration 3/hour per address and 5/hour per client;
  verification resend 4/hour per identity with a 60-second cooldown; sign-in 10 per 15 minutes per address and 30 per
  client; password reset 3/hour per address and 10/hour per client; password re-authentication 5 per 15 minutes per
  session.
- **Reset** consumes the token, stores the new verifier, retires every outstanding reset token and **revokes every
  session** — if the password was reset because someone else had it, their sessions end too.
- **Re-authentication** (§4.4) is per provider: a Google account re-authenticates with Google, a Telegram account with
  Telegram, an email account by confirming its password (`reauthenticateWithPassword`), all writing the same
  `Session.reauthenticatedAt` mark on that session only.
- **No automatic linking.** An EMAIL identity is never joined to a Google or Telegram account because the addresses
  match; they are different people to the system until an explicit, authenticated linking step exists (none does).
  Tested directly.
- **Google and Telegram are untouched**: their identities keep `passwordHash` NULL, never enter this flow, and a
  Telegram account with no address at all behaves exactly as before. Tested directly.
- **Deploying before the migration.** The code must be safe on a database that has not yet run
  `20260918190000_email_auth`, because the deployment and the migration are approved separately. The rule that makes
  that true: **no query on a per-request path may send the `EMAIL` enum value to Postgres.** A database without that
  value rejects the whole statement ("invalid input value for enum"), so a `where: { provider: "EMAIL" }` inside
  `resolveSession` would fail on every authenticated request and take down every signed-in page. `resolveSession`
  therefore *reads* the provider column and compares in JavaScript. Every query that does send the value lives behind
  the feature gate and cannot run until the migration exists. A regression test renames the enum value away and
  asserts that sessions still resolve.
- **Feature gate** (`src/server/auth/email-availability.ts`): the method appears only when it is switched on, a mail
  provider that can really deliver is configured, and the database carries both the `EMAIL` enum value and the
  `AuthToken` table. Every page and every server action re-checks it, so an incomplete deployment shows fewer buttons
  rather than a broken registration form.
- **Email delivery** (`src/lib/email/`): a one-method `EmailProvider` interface with a Resend implementation (plain
  HTTPS fetch, no SDK, no native dependency) and a development `ConsoleEmailProvider` that prints the link to the
  server log and is refused in production. Only two messages exist, "confirm your email" and "reset your password";
  no marketing, no tracking pixels. Verification URLs are built from `APP_URL`, which is
  `https://www.mellocrush.com` in production.

### 4.1c Android sign-in: the Custom Tab handoff (2026-09-21)

Google refuses OAuth inside an embedded WebView (`disallowed_useragent`) and Telegram is no friendlier, so the shell (§28) runs the flow in a Chrome Custom Tab and carries the result back over a one-time handoff.

The website's path is untouched and is still what runs when no request asks otherwise. The app adds `?client=android&challenge=<base64url SHA-256>` to the same `/auth/<provider>/start` endpoint; the challenge is stored in the existing signed pending-auth cookie, so nothing on the wire can introduce or alter it. State, nonce, PKCE and the provider binding all run exactly as before. Only the last step differs: instead of setting a session cookie in a browser jar the app cannot read, the callback issues a code and redirects to `com.mellocrush.app://auth/callback?code=…`, and the app redeems it at `/auth/handoff?code=&verifier=` inside its own WebView.

What crosses the gap is a 256-bit random code, in one deep link, once, for two minutes — and nothing else:

- **No session token is ever in a URL, and none is stored.** The session does not exist when the code is issued; it is created at redemption, inside the WebView, so it records the WebView's own user agent and address. It is then set as the same HttpOnly, Secure, SameSite=Lax cookie the website uses.
- **The code is stored only as a SHA-256 digest** (`AuthHandoff.codeHash`), so a database reader cannot redeem one.
- **The code alone is not enough.** An Android custom scheme is claimable by any installed app, so the deep link may reach a hostile one. Before opening the browser the real app generates a verifier it never sends anywhere, and redemption requires it — an interceptor holds a code it cannot use. PKCE's argument, applied to the second hop.
- **Replay is impossible**: redemption is a conditional update on `consumedAt IS NULL`, so two racing attempts cannot both win, and a wrong verifier does not burn the code for the real app.

Every failure returns the same nothing. Tested in `tests/integration/android-handoff.test.ts` and `tests/unit/native-deep-link.test.ts`.

### 4.2 Sessions (as built)

- Opaque 32-byte token (base64url) in cookie `thundi_session`: `HttpOnly; SameSite=Lax; Path=/`, `Secure` in production. The database stores only `sha256(token)` plus user id, created/lastSeen/expires, user agent and the IP /24 prefix.
- 30 days idle, 90 days absolute, sliding refresh at most hourly; expired rows are deleted on first sight. Logout (`POST /auth/logout`, same-origin checked, or the Settings action) revokes exactly that session; `revokeAllSessions` exists for "log out everywhere". `Session.reauthenticatedAt` records a fresh re-authentication with the account's own provider (Google or Telegram) for destructive actions (§4.4).
- Route protection has two layers with no possible loop (`src/server/auth/route-access.ts`, unit-tested): `proxy.ts` sees only cookie presence and bounces anonymous requests away from `/onboarding` and the app; the server layouts call `getAuthState()` (React `cache`, one lookup per request) and apply `resolveAccess`: anonymous → `/` (welcome, Continue with Google / Telegram), onboarding → `/onboarding`, active → `/discover`. The sign-in start/callback (both providers) and logout endpoints are allowed for every state (they decide for themselves). Suspended, banned or deleted accounts cannot sign in (`ACCOUNT_UNAVAILABLE`) and an existing session for them resolves as anonymous. Server actions never accept a user id; `requireActor()` derives it from the session and Zod strips unknown keys.
- CSRF: server actions are same-origin by construction; the mutating route handlers (`/api/photos`, `/api/community/posts`, `/auth/logout`) refuse cross-site `Sec-Fetch-Site`; the OAuth callback is bound to the browser that started it by the signed state cookie. Baseline headers from `proxy.ts`: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera self, geolocation denied). A nonce-based CSP is scheduled for Phase 12 hardening.

### 4.3 Age gate and onboarding state (as built)

- Onboarding progress is a named pointer, `User.onboardingStage` (`NAME → DOB → GENDER → MEET → INTENT → LOCATION → PHOTOS → ABOUT → PRIVACY → COMPLETE`), never a numeric step. Each stage saves immediately and advances the pointer only forwards; going back and editing never moves it backwards; `COMPLETE` is set only by `completeOnboarding`, which re-validates every required field and the age on the server before switching the account to `ACTIVE`. `/onboarding` resumes at the pointer; a URL for a later stage redirects to it.
- Date of birth is validated as a real calendar date and `ageFromDateOfBirth(dob, now) >= 18` on the server (UTC, tested at exactly 18 and 17 years 364 days). A refused date is never stored. DOB lives only on `User.dateOfBirth`; profile DTOs expose the derived `age` and the owner's onboarding data exposes day/month/year only to the owner.
- Required to finish: name, DOB, gender, who to meet, intention, location and at least two non-rejected photos. Bio, interests, prompts and verification are optional and feed the completion percentage (`src/server/profiles/completion.ts`, single source of truth for both the onboarding "done" screen and the Profile ring).

### 4.4 Account actions: log out, pause, delete (as built in Phase 9)

- **Log out** (Settings → Account management) revokes exactly the current session (`revokeSession`) and clears the cookie. The prototype has no "log out everywhere"; `revokeAllSessions` remains available for support tooling.
- **Pause dating** (prototype "Pause Dating" / Privacy visibility "Hidden") sets `PrivacySettings.visibility = HIDDEN` and `pausedAt`. The user leaves Discover (`discoverableSql`), receives no deck (`emptyReason = PAUSED`) and cannot send likes (`likeUser` refuses with `InvalidStateError`), otherwise pausing would be Invisible Mode for free. Matches, conversations and Community are untouched. Resuming clears both fields. This is the prototype's only deactivation concept; no separate "deactivate" state was invented.
- **Delete account** requires recent authentication with Google (`src/server/auth/recent-auth.ts`): the sheet's first step explains the consequences; "Continue with Google to confirm" runs `/auth/google/start?purpose=reauth`, which binds the result to the current session id and, on a verified token **for the same identity** (`recordReauthentication` refuses any other Google account), sets `Session.reauthenticatedAt`. Back in Settings the second step, "Delete my account", calls `deleteAccount`, which atomically consumes a mark younger than five minutes on **this** session and refuses otherwise (`REAUTH_REQUIRED`). An old application session, another of the user's sessions, or a stale confirmation can never delete an account (tested). Deletion runs in one transaction and **anonymises** rather than hard-deletes: photos (rows and files), interests, prompts, profile text, likes, passes, notifications, contact hashes, push subscriptions and sessions are removed; posts and comments are soft-deleted with counters recomputed; active matches become UNMATCHED and their conversations LOCKED; the User row becomes `status = DELETED` with no phone, DOB or gender and a random `phoneHash`. The sign-in identity row is **kept** with its email and name scrubbed and `releasedAt` set. **Kept**: Report, Block, Message history, AuditLog (`account.deleted`), Subscription rows. Open policy: §20.
- **The same Google account after deletion** (`/auth/deleted`): the callback recognises the subject of a deleted account and shows "Your previous Mellocrush account was deleted" instead of signing in; nothing is revived automatically. Only the explicit "Create a new account" choice (`createFreshAccountForIdentity`) creates a brand-new `User` and moves the identity row to it (audit `account.recreated`); the deleted row keeps its anonymised state and safety records and loses the identity link. Signing in later lands on the new account. The choice is refused for identities whose account is not deleted. Tested end to end.

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

Edit profile → Photos reuses the Phase 5 pipeline and grid (`features/profile/photo-manager.tsx`, shared with onboarding): upload with progress and retry, remove, drag or button reorder, "Make main". `assertCanRemovePhoto` (in `photos.ts`) is the one place that enforces the minimum: once onboarding is complete a profile keeps at least `PHOTO_LIMITS.min` (2) non-rejected photos, so a removal that would drop below it is refused with an explanation; rejected photos can always be removed; onboarding accounts are governed by the completion gate instead. Pending photos are labelled "Under review" for the owner; other users see them only where the photo visibility policy allows (§7.1). Where a pending photo really is hidden (production), the grid also carries a status block under it — how many photos are waiting, how many were not allowed, and that the profile appears in Discover once `PHOTO_LIMITS.min` of them are approved — so an upload never looks published the moment it appears in the grid. The flag comes from `pendingPhotosAwaitReview()` and is threaded from the server page, so in development, where pending photos are already displayable, the copy does not claim a review that is not happening.

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
- `countRelaxedCandidates` (count only, no identities) distinguishes "filters too restrictive" from "nobody new" when a deck comes back empty. It applies the photo rule, so on its own it cannot tell "nobody new" from "everybody is still waiting for moderation" — both look like zero. `countAwaitingPhotoReview` (also a count only) asks the complementary question: how many otherwise-eligible people have enough photos but not enough *displayable* ones. `getDeck` resolves an empty deck in that order — `FILTERS` first because the viewer's filters are the only thing the viewer can act on, then `REVIEW`, then `EXHAUSTED` — and the client shows "New profiles are being checked" rather than "that's everyone for now". The signal reaching the member is the reason alone: no count, no handle, no photo, and a profile counted this way is still in nobody's deck. Under a policy where PENDING is displayable the two counts coincide and `REVIEW` can never occur.
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
- **`sendMessage`** transaction: per-sender advisory lock (`msg:<userId>`) → participant check → pair advisory lock → block re-check → conversation/match status → anti-spam ceiling → insert TEXT → `lastMessageAt` → sender's own read pointer → one unread `MESSAGE` notification per conversation for the other participant. Lock order (sender, then pair) is compatible with `blockUser`/`unmatchConversation` (pair only) and `likeUser` (usage row, then pair), so a send racing a block or unmatch either commits before it (and the conversation then locks) or is refused; tested five rounds.
- **Unlimited matched messaging** (§12.4): once two people are matched, messaging between them is free and unlimited on every tier. No cooldown, no quota, no per-message charge, and no entitlement lookup in the send path at all. The **30 messages/minute ceiling** is anti-abuse and applies to every tier, Plus included; it is never described as a subscription feature.
- **Validation:** trimmed, control characters stripped (newlines kept), 1–2000 characters (`MESSAGE_LIMITS`), TEXT only in this phase. Bodies are stored verbatim and rendered as text by React (`white-space: pre-wrap`); no HTML is ever interpreted.
- **History and polling:** `listMessages` returns the newest page (40, max 100) with a cursor for older pages; `pollConversation(afterId)` returns only messages newer than the client's newest id, oldest first, plus conversation status and the sender's availability. The client polls every 4 s while the tab is visible and online, pauses otherwise, and polls the Chats list every 10 s. `MessagingTransport` remains the seam for Supabase Realtime later: the UI consumes "new messages since X" and would not change.
- **Read state:** `markConversationRead` sets the participant's `lastReadAt`/`lastReadMessageId` and clears that conversation's `MESSAGE` notifications. It runs only when the conversation is on screen (on open, and when new incoming messages arrive while visible), never from the list. Unread counts and the Chats badge (`countUnreadConversations`) derive from persisted read state: conversations with incoming messages newer than `lastReadAt`.
- **DTOs** (`src/server/conversations/list.ts`, `messages.ts`): list rows carry the other person's handle, name, verified flag and displayable primary thumb (photo visibility policy), a 90-character preview with a "You:" flag, unread count and activity time; the header adds location (or null when hidden) and whether Unmatch is offered; messages carry `id, fromMe, kind, body, at`. No database ids of people, phone, DOB, storage keys, sender ids, moderation, subscription or report data appear; payload audits are tested. The list needs two bounded queries (rows with the latest message and participant fields; unread counts grouped by conversation).
- **Ordering:** by `lastMessageAt` (falling back to match time for unmessaged matches). Background writes (read state, `updatedAt`) never reorder. "New matches" are ACTIVE matches with no message yet; a conversation appears in one section only.
- **Optimistic send:** the bubble appears as "Sending…", is replaced by the persisted message on success, and shows "Not sent · Tap to retry" on a network error. A refused message is never left looking sent.
- **UI:** prototype Chats list (search, New matches row, rows with unread pills), glass conversation header (avatar, name, seal, island), aqua/primary bubbles with times, 44 px composer (multiline textarea, Enter sends, Shift+Enter newline). The composer is the same on every tier: no countdown, no timer-driven disabled state and no upsell, because matched messaging is unlimited. Send is enabled whenever there is text and the conversation is open. Desktop uses the prototype's master–detail (360 px list, conversation pane); the phone bottom nav hides on the conversation screen. `/chats` and `/chats/[id]` are `force-dynamic` and all mutations are session-scoped server actions.

### 9.4 Replies, edits and reactions (2026-09-22)

Migration `20260922120000_message_replies_edits_reactions`, additive throughout.

**Reply — a reference, not a copy.** `Message.replyToMessageId` is a nullable self-referencing FK (`ON DELETE SET NULL`). The quoted text is resolved at READ time by `loadQuotes`, never stored beside the reply, for two reasons: a quote copied by value freezes a sentence its author may still edit, and it puts a second copy of one person's words inside a row another person owns. The consequence is worth stating plainly — edit an original and every reply to it immediately quotes the new text. `loadQuotes` scopes its lookup by `conversationId` as well as by id, so even a reply whose target somehow pointed elsewhere renders as unavailable rather than leaking a line from another conversation. A missing or soft-deleted target degrades to `{ body: null, available: false }`, which the client draws as "Message unavailable"; the reply itself survives its target, because it is still something somebody said.

The **same-conversation rule is the server's**. `sendMessage` resolves `replyToMessageId` against `{ id, conversationId, deletedAt: null }` inside the transaction that has already proved participation, so "visible to the sender" needs no separate check: a message in a conversation you are a participant in is by definition one you can see. An id from another conversation, a deleted message and an id that never existed all fail identically (`ValidationError`), so nothing can be probed by trying. Tested with a sender who is a legitimate participant in *both* conversations, which is the case a membership check alone would wave through.

A reply raises **no notification of its own**. It is a message; the existing single unread `MESSAGE` row per conversation already reports it, already names the sender and already links to the conversation. A "replied to you" row beside it would be one act reported twice.

**Edit — one row, rewritten.** `Message.editedAt` records the last edit; `createdAt` is never touched, so the message keeps its place in the thread and every cursor that has already paged past it stays valid, and the id is kept so replies pointing at it keep pointing at it. `editMessage` enforces ownership in the statement rather than around it: `updateMany` is given `{ id, senderId: actor.userId, deletedAt: null, kind: "TEXT" }` together, so a request carrying somebody else's message id updates zero rows and gets the same `NotFound` as an unknown id. There is deliberately no read-then-decide-then-write. The rest of the send path's rules continue to apply unchanged — the same normalisation and 1–2000 limits, an empty result refused, the conversation must still be ACTIVE, blocks still checked through `getConversationForActor` — plus a ceiling of its own (`MESSAGE_SPAM_CEILING.editsPerMinute`, 20). INTRO and SYSTEM messages are not editable: an intro is what a Like carried, and a system line is nobody's words.

**Message deletion was audited and left alone.** `Message.deletedAt` has existed since Phase 3 and every read respects it, but nothing in the application has ever written it — there is no delete-message feature, and none was added here. The column is honoured (a deleted message is excluded from history, polls, previews and quotes) and otherwise untouched.

**Reactions.** `MessageReaction(messageId, userId)` — the composite primary key **is** the "one active reaction per member per message" rule, so nothing counts rows to decide what is allowed: add is an upsert that conflicts with itself, change is the UPDATE half of it, remove is a DELETE, and a double tap, a retried request or a replayed call all land on the same row. `emoji` is the `ReactionEmoji` enum, so the approved set is closed by the database and not only by the code. The API is **declarative, not a toggle**: the payload is the state the member wants to end up in, `null` meaning none. Sending ❤️ twice leaves one ❤️ — which is what "duplicate requests cannot create duplicate reactions" requires, and a toggle is by definition not idempotent, so a retry on a flaky connection would undo itself. Turning "tap the one I already have" into `null` is the client's job, because the client knows its own current reaction.

Authorization is re-derived from the message, never taken from the request: the conversation is looked up from the row, and only then is the actor's access to that conversation established through `getConversationForActor`. A block makes the conversation unreachable in **both** directions (`NotFound` for the blocker too), an unmatched conversation is `InvalidState`, and a SYSTEM line cannot be reacted to.

**`Conversation.interactionAt` — the watermark, and why it had to exist.** A reaction or an edit changes a message the other client is *already holding*, and the chat's incremental poll asks "anything after this id?", which by construction never revisits such a message. `lastMessageAt` cannot stand in: it moves only for a new message. So a write of either kind bumps `interactionAt`; the poll carries it out and the client hands it back, and only a watermark that has actually moved costs the server the second query that re-sends the newest `INTERACTION_WINDOW` (60) messages with their current state. The steady-state poll is therefore one extra column read, four seconds apart. The honest limit: a reaction **removed** from a message older than that window does not reach a peer scrolled that far back until they reload — nothing in the database is wrong, the screen is briefly stale, and any new message or reload corrects it.

**UI.** Long-press a bubble for a sheet (Reply / React / Edit on your own / See who reacted); on desktop the same menu comes from a ⋯ that appears on hover or keyboard focus, because long-press with a mouse means "select text" and `useLongPress` ignores mouse input entirely for that reason. The reaction picker is a floating row of six 44 px targets placed near the press and clamped inside the viewport — not a sheet, because a sheet covers the message you are reacting to. Grouped pills sit under the bubble and render **nothing** when nobody has reacted. `useLongPress` never calls `preventDefault` and never sets `touch-action`: the timer is cancelled by movement past 10 px and by `pointercancel`, which is exactly what the browser sends when it takes the gesture over to scroll, so the gesture cannot hold a scroll. Bubbles are `select-none` below the desktop breakpoint and `select-text` above it, so a mouse keeps drag-select while a phone gets the menu gesture. Message bodies are plain text (React escapes them; no anchors are produced), so there are no links inside a bubble for a press to interfere with.

**Swipe-right-to-reply** was built under the same constraint and is likewise structurally unable to interfere: no `preventDefault`, no `touch-action`, and the gesture must declare itself horizontal (past 12 px and more than twice as far across as down) before anything visible happens; a finger heading down the screen is a scroll and is never a swipe, and `pointercancel` snaps it back. The worst it can do is fail to fire.

## 10. Safety: block, report, unmatch (as built in Phase 7; settings UI in Phase 10)

- **Block** (`src/server/safety/block.ts`): under the pair lock, inserts `Block`, sets an ACTIVE Match to BLOCKED and its Conversation to LOCKED, deletes the pair's likes. Blocked pairs disappear from every list through the shared predicate and `getConversationForActor`; history is retained. No notification reaches the blocked user. From a conversation: options sheet → "Block" → confirmation dialog ("Block {name}?").
- **Report** (`src/server/safety/report.ts`): reasons are the eight approved `ReportReason` values; the target is resolved from the conversation on the server (a client-supplied target id is ignored); the report stores reporter, target, reason, optional note and a snapshot of the latest 50 messages, then blocks the target with `source = REPORT`. The confirmation copy says so explicitly ("Submitting also blocks {name}", button "Submit report and block"), followed by the prototype's "Thanks for looking out" sheet. Nothing is deleted.
- **Unmatch** (`src/server/conversations/unmatch.ts`): under the pair lock, Match → UNMATCHED (with who and when), Conversation → LOCKED, pending notifications cleared. Messages remain; neither side can send; the conversation leaves both lists and stays readable at its URL with "This conversation has ended." Offered only while the match is ACTIVE, behind a confirmation dialog.
- Moderation foundation unchanged: `User.role` is not writable by any action; report rows are queryable for the Phase 12 review surface.
- **Blocked users (Phase 9)** (`src/server/safety/blocked.ts`): Settings → Privacy → Blocked profiles lists the blocker's own blocks with the minimal identity needed to recognise someone (name, seal, avatar) and offers Unblock behind a confirmation. `unblockUser(actor, handle)` deletes only the row where `blockerId` is the session user (a foreign block or unknown handle is NotFound). It restores nothing: the Match stays BLOCKED, the Conversation LOCKED, deleted likes stay deleted, and nobody is notified; future discovery simply follows the normal predicate again.
- **Block my contacts — REMOVED from the product (owner decision, 2026-09-22).** It matched people by phone number, and Mellocrush does not ask for one: sign-in is Google, Telegram or email, and production held **zero** phone numbers and **zero** contact hashes while fourteen members had the setting switched on. The control could never block anybody, and a privacy control that does nothing is worse than none, because it is believed. Gone from onboarding step 11, from Settings → Privacy & Safety (card and sheet), from the Settings index row and from the admin user detail. `savePrivacy` no longer reads or writes `blockContacts`, and `privacyTogglesSchema` no longer accepts it, so nothing can set it and the stored value of those fourteen members is left exactly as it is. What REMAINS: the `ContactHash` table, `PrivacySettings.blockContacts`, `src/server/privacy/contact-hashes.ts` and the `noBlockOrContactSql` join. The read side is still live on every discovery and Community query, and the module is the only thing that can put a row there, so deleting it would leave that filter with nothing able to exercise it (`billing.test.ts`, `google-auth.test.ts`, `profile-settings.test.ts` all use it). With no writer reachable from the app the join is a permanent no-op in production; removing it from the predicate, and dropping the columns, is a deliberate separate change — see §20.

## 11. Verification (Photo verified, as built in Phase 10)

**Meaning.** The badge says exactly one thing: a person on the team compared a selfie the member took with the member's profile photos and judged that they show the same person. It is not an identity, nationality, age or background check, and Google sign-in is never evidence (it confirms a Google account, nothing about who is in the photos). Every surface words it as **Photo verified**: the badge's accessible label, the member's status rows, the admin dialogs.

**State machine** (`src/server/verification/state.ts`, enforced inside every transaction): `NONE | PHONE_VERIFIED | REJECTED → SELFIE_SUBMITTED → UNDER_REVIEW → VERIFIED | REJECTED`. `PHONE_VERIFIED` is a legacy value that behaves like NONE. The review provider (`provider.ts`) is human review only (`manual_review`): a submission goes straight to UNDER_REVIEW and a reviewer decides. No face recognition, no similarity score, no external API.

**Member side** (`src/server/verification/verification.ts`, `/settings/verification`, `POST /api/verification/selfie`): instructions (recent photo, face visible, good light, only you), then "Take a selfie" (file input with `capture="user"`) or "Choose from photos", a local preview, and "Submit for review". `submitSelfie` checks eligibility (ACTIVE account with completed onboarding; suspended, banned, deleted and onboarding accounts are refused), the state (nothing pending, not already verified), the **24-hour retry window** after a rejection, a rate limit of 3 uploads per hour, size (8 MB) and format (sharp sniff; PDF and HEIC get accurate messages). The image is re-encoded to WebP with metadata dropped (`processImage`) and stored under `verification-selfies/<userId>/<uuid>.webp` in the private bucket; a replaced selfie's file is deleted. The member's DTO carries the phase (NONE / PENDING / VERIFIED / REJECTED), dates, the reviewer's reason, `canSubmit`, `retryAvailableAt` and, while pending, a 5-minute signed URL of their own selfie; never the storage key.

**Admin side** (`/admin/verifications`, `/admin/verifications/<userId>`, `src/server/admin/verification.ts`, permission `verification.act` for ADMIN and MODERATOR): the queue of pending submissions; the detail shows the selfie beside the member's profile photos (all moderation states), submission time, attempts, the account state, earlier decisions from the audit log, and Verify / Reject with confirmation (rejection needs a reason of 3–300 characters that the member reads). `decideVerification` runs under a row lock, refuses anything not pending or without a selfie, writes a `VERIFICATION_UPDATE` notification and a `verification.decided` audit row, and never touches the account status (verifying does not unsuspend anyone). A reviewer cannot decide their own verification.

**Badge surfaces**: discovery card and full profile, Likes You tiles, chat list and header, Community post and comment authors, the member's own Profile tab and status rows. All read `Verification.status = VERIFIED` through the visible-profile DTO as a boolean.

**Privacy and deletion**: selfies live only in the private bucket under server-chosen keys, reachable by the owner (while pending) and by reviewers through short-lived signed URLs; no permanent URL exists. Account deletion (`deleteAccount`) deletes the current selfie file and resets the row to NONE. Tests: `tests/integration/verification.test.ts`.

**Photo changes after verification (decision pending)**: no rule exists in the product specification, and none was invented. Today the badge persists when a verified member changes profile photos. Recommended policy for the owner to approve before it is built: keep the badge while at least one photo present at verification time remains; when every photo from that set has been replaced, move the member back to NONE with a notice ("Your photos changed, verify again to keep the badge") rather than silently. Implementing it needs the verified photo set to be recorded at decision time (one new nullable JSON column or a small table), so it is a schema change and waits for approval.

## 12. Monetization: Mellocrush Plus, entitlements and usage limits (approved 2026-09-17)

This section supersedes every earlier statement about like caps, incognito mode, rewind and plan pricing in this document and in the prototype audit. Registration is free and the core dating loop stays usable without paying.

### 12.1 Approved product rules

| Rule | Free | Plus |
| --- | --- | --- |
| Registration, profile, photos, discovery, matching | included | included |
| Likes | 30 per rolling 24-hour window | 90 per rolling 24-hour window |
| Pass | unlimited, never consumes likes | unlimited |
| Chat with matches | included | included |
| Messaging your matches | unlimited | unlimited |
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
  FREE: { dailyLikeLimit: 30, canSeeIncomingLikes: false,
          canUseInvisibleMode: false, boostsPerWindow: 0, canUseAdvancedFilters: false,
          canUndoPass: false, introsPerWeek: 1 },
  PLUS: { dailyLikeLimit: 90, canSeeIncomingLikes: true,
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

### 12.4 Matched messaging is free and unlimited (revised 2026-09-19)

**Rule: once two people are matched, messaging between them is unlimited on every tier.** No cooldown, no quota,
no per-message charge, in any combination of Free and Plus. This is a product rule, not a tuning value.

It used to be otherwise: Free senders were limited to one outgoing TEXT message per 9 minutes, measured globally
across all their conversations, and lifting that wait was sold as a Plus feature. That contradicted the intended
product — a dating app whose core loop is conversation cannot meter the conversation — so it was removed
entirely rather than set to zero.

"Removed entirely" is deliberate and worth stating, because it is what stops the rule coming back:

- There is **no `messageCooldownMs` field in `TierRules`**. No tier can express a wait, so it cannot be
  reintroduced by editing a config value; it would take a schema change to the rules table and would be visible
  in review. `tests/unit/rules.test.ts` asserts the absence of the property, not merely that it is zero.
- `sendMessage()` performs **no entitlement lookup at all**. The send path does not know or care what tier the
  sender is on.
- `MessageCooldownError`, the `MESSAGE_COOLDOWN` domain code, the `COOLDOWN` action code, `getMessageAvailability`,
  `AvailabilityDto` and the composer's countdown are all gone. There is no plumbing left to re-wire.

What still guards the send path, unchanged:

1. `sendMessage()` opens a transaction and takes `pg_advisory_xact_lock(hashtext('msg:' || userId))`, then the
   pair lock, so a send racing a block or an unmatch either commits before it or is refused.
2. The sender must be a **participant** in a conversation whose status and match are both `ACTIVE`; a
   non-participant gets `NotFound` and cannot tell the conversation exists.
3. Neither party may have **blocked** the other; the check is repeated inside the transaction.
4. The body is validated (non-empty, at most `MESSAGE_LIMITS.maxLength`, control characters stripped).
5. The **30 messages/minute anti-spam ceiling** applies — identical on Free and Plus. It is a safety rule and is
   never presented as something an upgrade removes.

Because the advisory lock still serialises a sender's concurrent sends, six simultaneous sends now all commit
(they queue, they do not contend for a quota), and each one's spam-ceiling count sees every committed predecessor.

The one messaging limit that is still tier-dependent is the **Intro** (`introsPerWeek`), and it applies *before*
a match exists — an intro is a note attached to a like, not a message in a conversation.

### 12.5 Likes You

Free: the read model returns `{ count, placeholders: [{ blurhash, verified }] }` where the blurhash is the primary photo's precomputed 28-character placeholder stored on `ProfilePhoto`. It contains no identifier, name, age, location or URL, and the list order is randomised per request so it cannot be aligned with other lists. Plus: the read model returns full `VisibleProfile` DTOs through the standard visibility predicate. There is no route that serves the real image to a Free client.

Phase 10 built the screen (`/likes`, `src/server/likes/likes-page.ts`): Free receives `count` and `placeholders` (blurhash + verified flag) and renders blurred tiles behind a lock card ("N people like you · Plus feature · See who likes you" → the lock sheet → Membership); Plus receives the standard discovery card DTO and can open a profile, like back (a mutual like shows the match screen) or pass. The Matches tab lists active matches with a way into each chat. Tested in `tests/integration/plus-enforcement.test.ts`: the Free payload contains no names, handles, ids or URLs.

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

Lapse semantics (approved 2026-09-17, fail closed): when Plus expires with `invisibleMode = true`, the predicate's second branch fails, so the user is **not** exposed. They stay hidden from new discovery; existing matches and chats remain accessible. This grants nothing premium for free. A subscription expiry must never unexpectedly expose a privacy-sensitive profile. When the user returns, `getInvisibleModeState()` reports `{ enabled: true, effective: false, suspended: true }` and the UI shows a clear state, "Your Invisible Mode is still on.", with two actions: renew Mellocrush Plus, or turn Invisible Mode off and return to normal discovery. The lapse also creates an `ACCOUNT_NOTICE` notification. Turning the flag on as a Free user is refused by the action and leads to the Plus upgrade experience.

Invisible Mode and Community (approved 2026-09-17): Invisible Mode is a Discover rule only. It does not affect existing matches, conversations or Community participation (posting, commenting, reacting, being viewed under Community privacy rules), and Community can never make an Invisible Mode user discoverable or reveal their state (§14.8). The setting UI states this explicitly.

Settings surface (Phase 9): Invisible Mode is the "Only people I like" option of Privacy → Profile visibility (Plus tag). A Free user who selects it gets the Plus explanation and nothing is stored; the server action calls `setInvisibleMode`, which refuses without the entitlement, so a direct request cannot enable it. The option's explanation always carries the Community disclosure above. The suspended state (Plus lapsed, flag still on) is shown as a warning with "Renew Mellocrush Plus" and "Turn Invisible Mode off". `getMembership` (`src/server/entitlements/presentation.ts`) is the only subscription payload the browser receives: tier, plan name, period end, cancel flag, capability flags and plan names; never provider references, override reasons or prices while `isPlaceholderPrice` is set (the Membership page shows "Price TBA" and states that payments are not available).

### 12.6a Anti-abuse ceilings are not monetization

The 30-messages-per-minute ceiling (`MESSAGE_SPAM_CEILING`) and the OTP/upload rate limits are **safety rules**. They apply to every tier, Plus included, and are never presented as something an upgrade removes. Plus lifts no messaging rule at all — messaging a match is unlimited for everybody.

### 12.6b Configuration defaults confirmed 2026-09-17

Boosts: 2 per rolling 7-day window, 30-minute duration, no performance multiplier claims in copy. Pass resurfacing: 30 days, configurable via `PASS_TTL_MS`. Undo: no time limit (§12.7).

### 12.7 Undo (last Pass)

Plus only. `undoLastPass(actor)` locks the actor's most recent `Pass` (undone or not) and reverses it only if it is still eligible: it has not already been undone and no later `Like` exists. There is **no time-based expiry** (approved 2026-09-17); `UNDO.maxAgeMs` in `src/config/product.ts` is `null` and remains as a structural hook so a limit can be reintroduced in one line. It sets `undoneAt = now` and returns the profile so the client can put it back on top of the deck. Discovery excludes only passes with `undoneAt IS NULL`. Nothing is deleted, only the latest action can be reversed, and only once; arbitrary historical undo is impossible by construction.

### 12.8 Profile Boosts

Plus allowance 2 per rolling 7-day window, using the same `UsageCounter` mechanism with `kind = 'BOOSTS'` and a 7-day window (Free limit 0, so any Free activation is rejected). Activation inserts a `Boost (userId, startsAt, endsAt = startsAt + BOOST.durationMs)`. Only one boost may be active at a time. Discovery ordering places candidates with an active boost first; the weight and duration live in `src/config/product.ts`, not in query code. Copy never claims a multiplier: "Get seen sooner" / "Temporarily increase your visibility in discovery."

Phase 10 added the control: a Boost button in the Discover header (`boost-control.tsx`). Plus confirms ("Boost for 30 minutes", with the weekly allowance shown) and then sees the minutes left as a compact ocean pill (the full countdown is its accessible name; on phones under 390 px the header keeps only the logo mark while a boost runs, so nothing wraps); Free gets the Plus lock sheet. `getDeck` carries the allowance (`boost`) so the header never guesses.

### 12.9 Advanced filters

Free: age range, show me, location (Anywhere / Greater Malé / My atoll / specific city), intention, as in the prototype. Plus adds: specific island or atoll selection, height range, education, and combined filters. Distance is deliberately absent and no coordinates exist in the model.

### 12.9a Lock UX (Phase 10)

One component, `PlusLockSheet`, is the lock state for every paid capability: the feature's name, "Plus feature", one short sentence, and a single "Get Mellocrush Plus" link to Membership. Approved 2026-09-20: a locked tap always lands on this sheet first rather than going straight to `/settings/membership` — landing on a pricing page with no idea which tap caused it is worse than one sentence of context — and the sheet is held to that one sentence plus that one CTA so the step stays cheap. Membership itself shows the honest state when no plan is for sale ("Plus isn't on sale yet"), so a lock never leads into a dead checkout. The like-limit dialog, the locked advanced filters, Undo and Boost all route there. Locks are UX only; every paid action is refused on the server regardless (`tests/integration/plus-enforcement.test.ts`). Membership also shows a Free vs Plus comparison table built from `PRODUCT_RULES` on the server (`MembershipDto.comparison`), never from component constants.

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
- **Receipt** (`/api/payments/<orderId>/receipt`, same-origin, session-owned): JPG/PNG/WebP up to 8 MB, sniffed and re-encoded to WebP with metadata dropped (`processImage`), stored in the private bucket under `payment-receipts/<userId>/<orderId>/receipt-<attempt>.webp` (the previous attempt's file is deleted), 10 uploads per hour. PDF and HEIC are named explicitly in the refusal message instead of failing obscurely (`src/server/media/sniff.ts`; the message depends on the upload context, so a selfie or profile photo is told "not a photo, choose a JPEG, PNG or WebP" rather than receipt advice). Paying is two steps since §12.14: **attach** (store + OCR check, order stays AWAITING_PAYMENT; "Replace slip" repeats it) and **submit** (`submitPlusOrder`: AWAITING_PAYMENT → SUBMITTED, needs an attached receipt, idempotent; a submitted receipt can no longer be swapped). The browser never sees the storage key, only 5-minute signed URLs, and only the owner and admins can obtain one. Uploading grants nothing.
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
| Message spam ceiling | `pg_advisory_xact_lock` per sender + a count over the last 60 s inside the transaction | Concurrent sends queue on the advisory lock, so the count each one sees includes every committed predecessor. |
| Boosts per window | same `UsageCounter` row lock, kind BOOSTS, plus a check for an already-active boost | as likes |
| Undo | row lock on the latest pass + "is latest action" check | Only one reversal can win; nothing else is mutated. |
| Mutual match | unique `(userAId, userBId)` with `ON CONFLICT DO NOTHING` | as section 8 |
| Duplicate bank transaction id (§12.14) | `pg_advisory_xact_lock(hashtext('txn:<sha256>'))` around the lookup and the `ReceiptVerification` insert | Two receipts with the same number cannot both be recorded as "not seen before"; the second sees the first's committed row. |
| Payment approval | `SELECT … FOR UPDATE` on the order + advisory lock per customer + unique `Subscription.orderId` | Concurrent approvals serialise; the loser sees APPROVED (or the unique violation) and reports idempotent success. |
| One open order | advisory lock `order:<userId>` inside the create transaction | Two simultaneous "Get Plus" taps yield one order. |

All of these are covered by integration tests that fire parallel transactions against a real Postgres (section 17).

### 12.14 OCR-assisted receipt verification (as built in the Receipt OCR phase)

OCR is an assistant to payment verification, never the source of truth. Nothing in `src/server/ocr/*` can move an order or create a `Subscription`; the canonical rule stays **admin approves → `approveOrder` transaction → entitlement**. A reading is advice for a person: the customer sees a summary before submitting, the admin sees everything beside the image.

- **Engine** (`src/server/ocr/engine.ts`): tesseract.js 7 running **server-side** in a Node worker thread with the English `4.0.0_best_int` model (2.9 MB, LSTM only). The receipt never leaves Mellocrush and no third-party OCR/AI service is called. Worker per request, terminated afterwards; hard timeout 25 s; on Vercel the wasm core, worker script and model are traced into the two functions that read receipts (`next.config.ts`, `docs/DEPLOYMENT.md` §7). Measured locally: worker start ≈ 0.3–0.6 s, recognition ≈ 1 s for a phone-sized receipt. `setOcrEngine` swaps in a text-returning stub for tests. An OCR-only derivative (greyscale, normalised, upscaled to ≥ 1400 px, PNG) is built with sharp and discarded; the stored WebP is what the admin sees.
- **Parsers** (`src/server/ocr/banks/*`, versioned `bml-v1`, `mib-v1`, `generic-v1`): `detectBank()` → the bank's parser → `parseCommon()` extractors → `NormalizedTransaction`. Rules are ported from the AVITO codebase's proven readers of real BML and MIB slips: BML's split headline ("150.00" / "MVR"), `Status` row (the `Message` row says "submitted for processing" even on success and is ignored), `Reference` = the bank's transaction number, `Remarks`; MIB's unlabelled headline amount, bare `Success`/`Processed` status, `Transaction#`, the account on the line **below** `To`, and the `Processed Date` row that must never be read as a status. Extracted: bank, status (COMPLETED / PENDING / FAILED / UNKNOWN with the bank's own word kept), amount in **integer minor units** (`toMinorUnits`, never floats; "MVR 199", "MVR199.00", "199.00 MVR", "Rf 199.00"), currency (MVR/USD/other), transaction id (label-introduced only, OCR-split fragments rejoined, never an amount/date/time/Thundi reference), destination account (source accounts excluded), sender/recipient names (display and supporting evidence only), transaction date parsed as Maldives time (UTC+5, day-first), remark text, and a `THU-XXXXXX` reference if present. Raw OCR text is **not stored and not logged**; production logs carry `[ocr] completed … bank=BML amountParsed=true` style diagnostics only (tested).
- **Verification** (`src/server/ocr/verify.ts`, pure): compares the reading with the **order snapshot** (never the plan's or method's current row). Per-check states `MATCH | MISMATCH | NOT_FOUND | UNCERTAIN | NOT_APPLICABLE` for bank, status, amount, currency, recipient, reference, transactionId, duplicate, date. Recipient: exact digits → MATCH; same length one digit off → UNCERTAIN (never a match); otherwise MISMATCH; a name without an account is at most UNCERTAIN. Reference: equal → MATCH, one character off → UNCERTAIN, different → MISMATCH, absent → NOT_FOUND (never a failure). Date: more than an hour before the order's creation → MISMATCH (cannot have carried the reference; date-only readings are compared as the whole day), in the future → UNCERTAIN. Outcome derived from the checks, never from the engine confidence: `OCR_FAILED` (engine could not look), `UNSUPPORTED_RECEIPT` (read, but no bank, amount, account, status or transaction number), `MISMATCH` (amount, currency, recipient or a FAILED status disagree), `REVIEW_REQUIRED` (duplicate, pending, wrong reference, pre-order date, uncertain recipient, amount unread), `MATCH` (bank + status + amount + currency + recipient all match), else `PARTIAL_MATCH`.
- **Persistence** (`ReceiptVerification`, migration `20260918120000_receipt_ocr`): one row per pass (each upload, each admin re-run), `attempt` unique per order, `parserVersion`, `engine`, outcome, the normalised fields, `checks` JSON, `transactionIdHash` (sha256 of the normalised id, indexed). Written only by the server from the stored image (`runVerification`); the browser posts a file and an order id and nothing else (tested: the route reads exactly one form field).
- **Duplicate detection**: inside the verification transaction, `pg_advisory_xact_lock(hashtext('txn:<hash>'))` then a lookup of other orders' rows with the same hash. A hit is a **review signal**: the customer sees a fixed line ("This receipt looks like one that was already submitted"), the admin sees the other order's reference, status and same/different customer with a link. Nobody is banned or accused automatically, and the earlier order's own reading is never rewritten.
- **Customer view** (`toCustomerCheckDto`): outcome, fixed title/summary, and checks with fixed wording; only the detected amount/currency/status and this order's expected values are shown. Never sender name, transaction number, another order, `meta` or raw text. Wording distinguishes "your bank shows this transfer did not go through" (FAILED) from "we couldn't automatically verify the transfer details" (OCR failure); OCR failure never blocks submitting.
- **Admin view** (`/admin/payments/<id>`): receipt image and the check panel side by side; every check with state, detected/expected and note; detected fields; duplicate warning; attempt history; **Re-run OCR** (`reprocessReceipt`: `payments.review`, 10 per admin per hour, audited `receipt.reprocessed`, appends a row, changes no state, grants nothing). Approve/Reject remain human. When the latest reading is a `MISMATCH` or a duplicate, approval **requires a reason** (server-enforced, 3–300 chars) and the `payment.approved` audit row carries `receiptOutcome` and `overrideReason`; a MATCH never auto-approves.
- Tests: `tests/unit/ocr-parsers.test.ts`, `tests/unit/ocr-verify.test.ts`, `tests/integration/receipt-ocr.test.ts` (one case runs the real engine on a rendered fixture); fixtures in `tests/fixtures/receipts.ts` are sanitised layouts, not real receipts.

### 12.15 Read receipts ("Seen")

Both halves existed from the start and were connected to nothing: `ConversationParticipant.lastReadAt` was written
by `markConversationRead` and used only for unread badges, and `PrivacySettings.readReceipts` appeared in no file
outside the generated Prisma client. The sender was never told. This wires them together.

`getConversationReadState(db, actorId, conversationId, otherUserId)` returns one timestamp — when the other person
last read the conversation — or null. It is carried on the first message page and on **every poll**, because being
read is a change the sender should see even when nothing new was said.

**Two people must agree, and the rule is symmetric.** The reader must allow receipts, since it is their behaviour
being reported; and the viewer must allow them too, since otherwise turning the setting off would buy the ability
to watch without being watched. A receipt you take but never give is not a privacy setting, it is an advantage.
Every "no" returns null — blocked pair, setting off, chat never opened — so the client cannot tell "not read" from
"not telling".

Receipts are per conversation, not per message: the server reports one timestamp and a message counts as read if
it was sent before it. The UI labels only the newest such message; the ones above it are implied.

A missing `PrivacySettings` row reads as **on**, matching the column default, so an account that predates the row
is not silently opted out.

### 12.16 "Someone messaged you while you were away"

**The rule is presence, not timing.** A member who is in the app gets no email; a member who is away gets one
immediately. Waiting to find out what is already known — that nobody is there — only delays the mail, and mailing
someone mid-conversation is the thing to avoid.

Two paths, one delivery:

- `notifyAwayRecipient` runs the instant a message is sent. Recipient away → email now.
- `sweepUnreadMessageEmails` is the safety net for the one case the first path cannot see coming: the recipient
  **was** present when the message landed, so nothing was sent, and then they left without reading it. It sends
  only when the message is still unread **and** they are away by then, so it can never mail somebody who is still
  reading.

**There is no queue table and no migration.** The unread `MESSAGE` notification *is* the queue — one per
conversation, already cleared when the chat is opened, already suppressed when the recipient has message
notifications off. Both paths share one per-recipient, per-conversation throttle on `RateLimitBucket`, so a burst
is one email however it was triggered, and the sweep cannot re-send what the send path already sent.

**The email never carries the message.** An inbox is read over shoulders, synced to laptops and screenshotted by
people other than its owner; what two matches say to each other is theirs. It carries who wrote and a way back.

**What drives the safety net.** Every authenticated page render, since the app layout wraps all of them, behind a
global one-per-minute gate and never awaited. `/api/cron/message-emails` exists for a real scheduler and is
authorised by `CRON_SECRET` as an `Authorization: Bearer` header — the shape Vercel Cron sends. With the secret
unset the route refuses everything: an endpoint that triggers outbound email must never stand open. The main path
needs none of this, because it fires on the send itself.

`emailDeliveryConfigured()` is deliberately distinct from `emailAuthConfigured()`: the latter asks whether email
sign-in is offered, and `EMAIL_AUTH=off` says nothing about whether the mailer works.

### 12.17 Presence

`User.lastActiveAt` now means what its name says: the last time this member's browser asked the server for
anything. It used to be stamped only at sign-in.

The app had no usable liveness signal before this. `Session.lastSeenAt` is refreshed at most hourly on purpose, so
that browsing is not a database write per request, and a sign-in timestamp cannot tell somebody mid-conversation
from somebody who left this morning.

The write is conditional, so the common case costs one indexed `UPDATE` that matches no rows:

```sql
UPDATE "User" SET "lastActiveAt" = now() WHERE id = $1 AND ("lastActiveAt" IS NULL OR "lastActiveAt" < $2)
```

At one write per member per minute, an hour of clicking costs sixty touched rows rather than several hundred —
the reason sessions were kept coarse, without the coarseness.

It is touched in two places, and both are needed. The **app layout** covers every member-facing screen. The
**conversation poll** covers the one way to use the app without rendering a page: the chat screen polls every few
seconds, and without it somebody reading one conversation would read as away after five minutes and be emailed
about another.

`activeWithinMs` (5 min) is deliberately longer than `touchEveryMs` (1 min). A window equal to the refresh
interval would flicker — a member who loaded a page 61 seconds ago would read as away.

**This changes the admin dashboard.** Its 7- and 30-day figures used to count accounts that signed in during the
window; they now count accounts that actually used the app in it, which is what those labels always implied.

## 13. Notifications

Types: `NEW_MATCH`, `MESSAGE`, `LIKE_RECEIVED` (Plus users see who; free users get a count-only notification), `INTRO_RECEIVED`, `COMMUNITY_LIKE`, `COMMUNITY_COMMENT`, `VERIFICATION_UPDATE`, `SAFETY_NOTICE`, `ACCOUNT_NOTICE`, and the billing types `PAYMENT_APPROVED`, `PAYMENT_REJECTED`, `SUBSCRIPTION_EXPIRING`, `SUBSCRIPTION_EXPIRED` (§12.12; transactional, not gated by preferences). Notifications never control authorization: the entitlement service and the database are canonical. Created inside the same transaction as the triggering write. Read model returns unread counts per tab for badges; `markRead(actor, ids | all)`. `NotificationSettings` (matches, likes, messages, community, marketing) gate creation of the non-safety types. A `PushSubscription` table is included in the schema so Web Push can be added without migration; no push is sent in this phase.

Settings (Phase 9): the five categories are toggles in Settings → Notifications (`src/server/notifications/settings.ts`, partial updates, unknown keys stripped). Each writer already consults the recipient's row when raising a notification, so turning a category off stops future rows of that kind and leaves history intact (tested). Marketing has no sender yet and is stored only; nothing is pushed.

### 13.1 The member's feed, the bell and the dropdown (2026-09-19)

Until now the rows existed but nothing showed them: there was no bell, no list and no way to mark one read. The
reader is `src/server/notifications/feed.ts` — `countUnreadNotifications`, `getNotificationFeed`,
`markNotificationRead`, `markAllNotificationsRead` — wrapped by `src/actions/notifications.ts` behind
`requireActor()`. It adds no notification type and no producer; `NOTIFICATION_FEED` in `src/config/product.ts`
holds the sizes (5 in the dropdown, 20 a page, 50 ceiling, 70-character previews) so the client can read them
without pulling the database layer into its bundle. **No migration:** the `Notification` model and its
`[userId, readAt, createdAt desc]` index already carried everything.

**Ownership is a WHERE clause, not a check.** Every query and every update matches the id *and* `userId` together,
so another member's notification id marks nothing and returns exactly what a nonexistent id returns
(`{ changed: false }`). Nothing distinguishes the two, so nothing leaks whether that id exists. `markAll` updates
`{ userId, readAt: null }`. Reading never deletes: the row stays, it just stops counting.

**What a row may name is an authorization question, so the server composes the text.** The client receives a
finished `title`, never an identity to hide:

| Row | Named | Anonymous |
| --- | --- | --- |
| `LIKE_RECEIVED`, `INTRO_RECEIVED` | viewer holds `seeIncomingLikes` and the actor is ACTIVE | otherwise — "Someone liked you", no photo |
| `NEW_MATCH`, `MESSAGE`, `COMMUNITY_*` | normally | blocked either way — no name, no photo |
| system rows | never carry an actor | — |

A like is the Plus paywall (§12.5). Sending the liker's name to a Free member's browser and hiding it in CSS would
hand away what Likes You charges for, so a Free member's row is anonymised in the query result itself. The same fix
was applied to the desktop Discover activity panel (`src/server/matching/aside.ts`), which had been naming likers
to Free members since it was built.

A message row previews the latest line of the conversation. That is safe because the viewer is a participant — and
the preview query re-asserts that participation rather than trusting the notification. Soft-deleted and non-text
messages are skipped; the preview is whitespace-collapsed and truncated.

**Destinations degrade rather than 404.** `href` is null when the target is gone (a deleted Community post); the
row still renders and can still be marked read, it just is not a link. A `NEW_MATCH` with no conversation falls
back to `/likes`.

**Paging** uses an opaque `"<createdAt ISO>|<id>"` cursor matching the `[createdAt desc, id desc]` order, so a page
boundary between two rows created in the same millisecond cannot drop one. A malformed cursor is ignored, not
trusted.

**No polling and no socket.** The authenticated layout already runs per request, so it counts unread rows there and
seeds `NotificationsProvider`; the bell costs nothing until it is opened, and the rows are fetched only on open.
After a read the client updates the count locally and calls `router.refresh()` so the next server render agrees.

### 13.3 Reaction notifications, and the duplicate-message rows (2026-09-22)

Two types were added — `MESSAGE_REACTION` and `COMMUNITY_COMMENT_REACTION` — and, deliberately, **no post-reaction type**: reacting to a post IS the existing `COMMUNITY_LIKE` producer, now carrying `data.emoji`, because the heart on a post card became the reaction control rather than gaining a rival next to it. One act, one producer, nothing that can report the same reaction twice.

`src/server/notifications/reactions.ts` exists because a reaction is not the kind of event every other producer handles. A match, a like, a message and a comment each happen once; a reaction is **state that can be edited** — ❤️, then 😂, then back, then off, four taps in five seconds on the same message — and the recipient must end up with one row saying the true thing. So: at most one UNREAD row per (recipient, type, target, actor), and a repeat UPDATES the waiting row rather than inserting beside it. `createdAt` is deliberately not refreshed; moving it would jump the row to the top of the feed on every tap, which is the spam wearing a different hat. Once the recipient has read it, the next reaction is genuinely new and starts a new row.

Idempotency is enforced rather than hoped for: the read-then-write sits inside the caller's transaction **and** behind `pg_advisory_xact_lock` on the exact tuple being written — the same technique already used for `msg:<sender>` in the send path and `txn:<hash>` in receipt duplicate detection. Two concurrent requests cannot both see "no unread row" and both insert. (The older producers use a plain `findFirst` + `create`; that is safe only because those events cannot race with themselves the way a double-tapped reaction can.) Nothing is written at all when the actor is the recipient, when either party has blocked the other, when the recipient's category is off (chat reactions follow `messages`, Community follows `community`, which is off by default), or when an unread row for the tuple already exists. **Removing a reaction never reaches this code**: the callers only notify when a new emoji is set.

`MESSAGE_REACTION` carries `conversationId` (its dedup scope and its destination, `/chats/<id>`) with the message id in `data`; `COMMUNITY_COMMENT_REACTION` carries the comment's `postId` (likewise, `/community/<postId>`) with the comment id in `data`. Neither needed a new foreign key.

**The duplicate-message-notification issue, diagnosed.** It is not a creation-path bug. Production has **zero** duplicate *unread* `MESSAGE` rows — the `findFirst` + `create` guard in `sendMessage` holds, and the per-sender advisory lock means it cannot race itself. What production does have is one recipient with **six** `MESSAGE` rows for the same conversation, all read, spanning twelve minutes: correct by design, because the guard is scoped to unread rows, so each message sent after the previous notification was read legitimately starts a new one. They *look* like duplicates because of the read model, not the write model: `messagePreviews` in `src/server/notifications/feed.ts` resolves each row's preview from the **latest visible message in that conversation** rather than the message that caused the row, so all six render the identical title and the identical line. The fix is a presentation change in the notification feed (collapse read `MESSAGE` rows per conversation, or resolve the preview from the causing message, which needs the message id stored on the row) and is **not** part of this change — it is recorded here so it is not rediscovered. Nothing added in 13.3 shares that shape: the reaction producers key their dedup on the actor and target and rewrite in place, so no new path can accumulate rows that say the same thing.

## 14. Community (as built in Phase 8)

Prototype behaviour reproduced: the Community tab (26/800 title; For You / Following / New pills; radius-24 post cards with 44 px avatar, 15/700 name + 14 px seal, "island · time" meta, 36 px ··· options, QUESTION tag, 16 px body, 240 px radius-18 photo, heart + count and comment bubble + count), the 54 px ocean FAB, and the "New post" sheet (Text / Photo / Question pills, 4-row textarea whose placeholder follows the kind, "Posting as {island} · Community posts don't create matches", 52 px ocean Post). Tapping the author avatar opens the full profile. The prototype has no thread screen, no Community nav badge, no follow feature, no image comments and no nested replies; its Share button has no behaviour and is not rendered.

14.1 Data model. The existing `CommunityPost` (kind TEXT | QUESTION | PHOTO, body, photoKey/photoBlurhash, likeCount, commentCount, deletedAt), `CommunityComment` (flat, soft delete), `CommunityLike` (primary key postId + userId), `Notification` (COMMUNITY_LIKE / COMMUNITY_COMMENT with actorId + postId) and `Report` (targetPostId) are reused. Migration `20260917200000_community_media_and_comment_reports` adds `CommunityPost.photoModeration` (PhotoModeration, default PENDING; text and question posts are stored APPROVED because only media is moderated) and `Report.targetCommentId` (+ index, RESTRICT) so comments can be reported with the same evidence snapshot. Counters are maintained in the same transaction as the like/comment write, recomputed from rows by the seed, and asserted equal to `count(*)` under concurrency in tests.

14.2 One visibility rule (`postVisibleSql`, used by feed, thread, reactions, comments and reports): not deleted; author ACTIVE and not deleted; no Block in either direction and no contact block (`noBlockOrContactSql`, shared with Discover); photo posts only when the media state is displayable under the photo visibility policy (§7.1) or the viewer is the author. Anything invisible reads as NotFound, never Forbidden. Comments hide by the same rule (deleted, blocked pair, non-active author). Suspended or deleted authors disappear with their content.

14.3 Feed and ranking. For You = every visible post, newest first. New = the last 24 hours, newest first. Following = posts by members the viewer follows (§14.12), through the same visibility SQL as every other tab. Any tab can be narrowed to one topic chip (§14.11). No engagement ranking. Pagination is keyset on `(createdAt DESC, id DESC)` with an opaque base64url cursor (`createdAt|id`), page size 12 (bounded at 50), `LIMIT n + 1` to derive `nextCursor`; stable under concurrent inserts and deletes. A page costs three queries — ids, posts plus the viewer's likes, authors in one `IN` query — so there is no N+1. Nothing personalised is cached: `force-dynamic` pages and cookie-scoped server actions.

14.4 Safe DTOs (`src/server/community/dto.ts`). Author: handle, display name, verified flag, first displayable photo (signed URL or demo key, blurhash), island label or null when `hideLocation`, `isMe`, `followed` (whether the VIEWER follows them — never the reverse, and never a count). Post: id, kind, topic, body, photo | null, `photoUnderReview` (author only), poll | null, likeCount, commentCount, likedByMe, createdAt, `isAnonymous`, author, isMine, context | null. Comment: id, body, createdAt, author, isMine. Never: phone, DOB or age, precise location, contact hashes, internal user ids, subscription, moderation or report data, session data. A test pins the exact key set.

14.5 Posting and media. `createPost` requires ACTIVE status, validates kind and body server-side (control characters stripped, 1–1000 characters, HTML kept as text and rendered as text by React), applies an anti-abuse ceiling (10 posts per hour per user via `consumeRateLimit`), and for photos runs `processImage` (sharp: format sniffed from bytes, JPEG/PNG/WebP only, ≤ 8 MB, ≥ 400 px, EXIF orientation applied, re-encoded to WebP so metadata is stripped, blurhash computed) then stores `community-photos/<userId>/<postId>/full.webp` through the storage abstraction and marks the post PENDING. Uploads go through `POST /api/community/posts` (multipart for progress; same-origin check; 401/413/422/409 mapping). The moderation policy is the central photo policy: development shows PENDING, production shows APPROVED only, so production never silently publishes an unreviewed photo — the author sees "Photo under review" and nobody else sees the post until it is approved (the same launch requirement as §7.1). Only the author can delete (soft delete; related notifications are marked read).

14.6 Reactions and comments. One heart per user per post: `INSERT … ON CONFLICT DO NOTHING` / `DELETE`, the counter changes only when a row changed, ceiling 60 per minute. Comments are flat (no nesting), 1–500 characters, oldest first, keyset paginated (30), ceiling 20 per minute, author-only soft delete with counter decrement. Likes and comments are optimistic in the UI and reconciled with the server response; a failed or offline call rolls back and shows a toast. The thread header shows the number of comments the viewer can see once the thread is fully loaded (blocked authors' comments are filtered), otherwise the public counter.

14.7 Report and block. Reporting a post or comment stores a `Report` with the approved reason, the target user resolved server-side and a content snapshot; it does NOT block the author (the prototype separates ··· → Report from Block, and Phase 7's conversation report keeps its approved report-and-block behaviour). The report confirmation says so and offers "Also block" as an explicit second step; Block is also a direct menu item with its own confirmation. Blocking uses the shared `blockUser` (pairwise, closes any match/conversation) and hides posts, comments and profiles in both directions immediately. Own content gets Delete only. Reporting own content is refused.

14.8 Dating boundary. Community never creates Like, Match or Conversation rows and offers no message action. The author overlay is the read-only full profile via `getCommunityProfile`: visible when the author is ACTIVE and not blocked either way (contact blocks included); hidden age/location and the photo policy are applied; the Discover eligibility predicate is deliberately not applied, so Community does not reveal who is discoverable. No Like/Pass controls: a dating Like must go through the Phase 6 path and its caps (Free 30 / Plus 90). Invisible Mode (owner decision, approved 2026-09-17, `COMMUNITY.invisibleModeParticipation = "ALLOWED"`): Invisible Mode controls dating-discovery visibility only. An Invisible Mode user may view Community, post, comment, react and have their Community profile and content viewed under the normal Community privacy rules; none of that makes them eligible for or visible in Discover unless the Phase 6 rules independently allow it, and Community never reveals dating eligibility, discovery preferences, likes or the Invisible Mode state. The Invisible Mode setting discloses: "Invisible Mode hides you from Discover. Your Community posts and comments can still be visible to other Community members." Regression-tested in `community.test.ts`. (`READ_ONLY` remains a one-line switch that hides the composer and rejects posts server-side, unused.)

14.9 Notifications. `COMMUNITY_LIKE` and `COMMUNITY_COMMENT` rows are created in the same transaction as the write, only when the recipient has `notificationSettings.community` on, never for one's own actions or across a block, and de-duplicated per (type, post, actor) while unread. No push. No Community badge in the nav (the prototype has none).

14.10 Limits (`COMMUNITY` in `src/config/product.ts`): post 1000 characters, comment 500, feed page 12, comments page 30, New window 24 h, 10 posts/hour, 20 comments/minute, 60 reactions/minute. Polls: 2–4 options, 60 characters each (`POLL_RULES` in `src/server/community/rules.ts`, which is import-safe from a client component because it reaches nothing).

### Community, made social (2026-09-21)

14.11 Topics. Six fixed chips — Dating 👀, Advice, Confessions, Questions, Polls, Random — as the `PostTopic` enum and `CommunityPost.topic` (nullable: a post need not sit under a chip, and every post written before this migration has none). `src/server/community/topics.ts` is pure (no server imports), so the chip row, the compose sheet and the query all name a topic with the same value. A fixed list rather than free-text tags: tags fragment a small community into near-empty rooms, and an open vocabulary cannot fit a 320 px chip row. `parseTopic` rejects anything else rather than storing it; the kind supplies a default (a poll lands under Polls, a confession under Confessions, a question under Questions) which the author can change.

14.12 Private follows (owner decision, 2026-09-21; option A). `CommunityFollow(followerId, followingId)` is one-directional and **invisible to the person followed**: they are never notified, they cannot see who follows them, and no DTO anywhere exposes a follower count. `src/server/community/follows.ts` has no function that answers "how many people follow X" — on a dating app a visible follow is a way to tell someone they are being watched, which the Community Guidelines call stalking (clause 14). The only thing a follow does is decide whose posts reach the follower's Following tab. Blocking wins in both directions and is enforced twice: `blockUser` deletes any follow between the pair in the same transaction, and the feed applies `postVisibleSql` to Following exactly as to the other tabs, so a follow row that somehow survives still cannot surface a blocked person's posts. `assertFollowable` refuses self, non-members, inactive and deleted accounts, and either direction of a block — all with the same NotFoundError, because "they blocked you" is itself information they did not share. Unfollowing deliberately skips the block checks so it always works.

14.13 Polls. `CommunityPollOption(postId, label, position, voteCount)` and `CommunityPollVote` keyed on `(postId, userId)`, so "one vote per member" is a primary key rather than a rule the application has to remember. Casting or moving a vote is one transaction covering the vote row and both counters, so a reader can never see a total that disagrees with the rows behind it; voting the same way twice is a no-op. Percentages use the largest-remainder method so the bars always add to 100. Who voted for what is never exposed: the DTO carries totals and the viewer's own choice only. Results are shown before and after voting — hiding them turns a question into a toll gate and makes people tap an option they do not mean.

14.14 Confessions and anonymity. `PostKind.CONFESSION` with `CommunityPost.isAnonymous`. The flag is **derived from the kind on the server**, never read from the request: a confession is anonymous, everything else is not, and `POST /api/community/posts` has no "anonymous" field at all, so no crafted request can post anonymously as another kind or strip the anonymity off a confession. `authorId` stays set and NOT NULL, so reports, blocks, moderation and the admin surfaces work on a confession exactly as on any other post — the brief's rule is that a confession may be *displayed* without its author, never that it becomes untraceable internally. Presentation is applied in one place, `buildPostDtos`, which every Community read goes through (feed, single post, thread, the DTO a fresh post returns): the author is replaced wholesale by the frozen `ANONYMOUS_AUTHOR` constant rather than patched field by field, so the rule is one value a test can compare against instead of five nullings where the sixth added later is the leak. Its empty handle is what the profile overlay already treats as "not available", so the name cannot be tapped into a profile; the card additionally renders the name and avatar as non-buttons and hides the follow control. Anonymous posts are also excluded from the "people posting lately" ranking (§14.15) — surfacing someone on the strength of posts nobody may attribute to them is a slow leak through a suggestion list. Tested in `tests/integration/community-social.test.ts`.

14.15 Social context and the modules beside the feed. Every number is counted from rows; there is no seeding, no placeholder activity and no invented "trending" score, and each query has a floor below which its module returns nothing and the UI omits it — a quiet Community should look quiet and offer something to do, not look busy and lie about it.
- `social-context.ts` — per post, in one query for a whole page: `participants` (distinct members who replied, excluding the author, who started the thread rather than joining it; shown from 3) and `popularIn` (an island shared by at least 3 located repliers **and** at least 60 % of them). A replier who hides their location is never counted towards an island, and an island is only ever a label over an aggregate of 3+, so it cannot be read backwards as "X is in Malé".
- `discover.ts` — "🔥 Popular today" (visible posts of the last 24 h with ≥ 2 replies, at most 3, shown only when at least 2 qualify; no author is named, which is what makes it safe for confessions), "people posting lately" (members the viewer can see, posts in the last 14 days excluding anonymous ones, not already followed, not self, at most 3) and "busy this week" (topics with posts in the last 7 days). All run through `postVisibleSql`, so blocks, contact blocks, suspended and deleted accounts and unreviewed photos are handled once.
- Conversation-starter prompts are editorial and static (`CONVERSATION_STARTERS`), which the brief allows precisely because they assert nothing about anyone. They are the last thing a brand-new Community falls through to, with the create button.

14.16 Migration `20260921120000_community_social` — additive only: `PostTopic`, two `PostKind` values, `CommunityPost.topic`/`isAnonymous` (nullable / default false, so every existing post keeps its meaning), three tables with their indexes and foreign keys, and `ENABLE ROW LEVEL SECURITY` on each new table (§15: every table in this database is RLS-enabled with no policies, and a new one that skips it is a hole in that wall).

### Reactions on posts and comments (2026-09-22)

14.17 The heart became the reaction control. `CommunityLike` gained `emoji ReactionEmoji @default(HEART)` and **kept its name**: a rename is not an additive migration, and every row already in it was already exactly what it should be — a ❤️ from that member on that post — so the 3 production rows became correct reactions without being touched. The alternative, a second parallel reaction system beside the existing heart, would have put two ❤️ on every post, one counting towards `likeCount`, Popular Today and `COMMUNITY_LIKE` and one not. What the reuse buys, all of it for free: "one active reaction per member per post" was *already* the primary key; `likeCount` was already the count of those rows, so it is now the total reaction count and Popular Today, the social-context line and the notification producer keep working untouched.

Comments get `CommunityCommentReaction(commentId, userId)` with the same shape. Three small strongly-keyed tables rather than one polymorphic `reactions` table with three nullable target columns: a real foreign key per target means the database itself refuses a reaction to something that does not exist, `ON DELETE CASCADE` needs no application code, and no read has to work out which column is set before it can authorise anything.

Counter exactness is decided by what Postgres reports about the statement, never by a read-then-write. A removal uses the DELETE's own row count; an add-or-replace is a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING (xmax = 0) AS inserted`, where `xmax = 0` is Postgres's own answer to "did this actually insert?" — so swapping ❤️ for 😂 increments nothing and five concurrent identical adds increment once. Tested under `Promise.all`.

Visibility and authorization reuse the existing rules exactly: `canSeePost` gates post reactions, and a comment's is re-derived from its post, so a comment id under a post the member cannot see is refused as an unknown id is. The reactor lists (`listPostReactors`, `listCommentReactors`) are bounded at `COMMUNITY.reactorsPageSize` (50) and filtered in SQL by `noBlockOrContactSql` plus ACTIVE-and-not-deleted, then rendered through `loadAuthors`, which already enforces "no staff account is ever shown as a member" and the photo policy. A member blocked *after* reacting still counts in the summary and is simply not named.

**Restraint in the UI, because the brief was explicit.** A post's grouped pills appear only when **more than one distinct** reaction exists — until then the control itself already says everything, one emoji and one count, and a second row repeating it is the "large row of permanently visible emojis" that was ruled out. A post nobody has reacted to renders precisely as it did before any of this existed, and the action row is the same 38 px row with the same two controls in the same order. Comment pills likewise render nothing until somebody reacts, which matters most there: the comment list is the densest surface in the app.

14.18 Limits: reactions share the existing 60/minute Community ceiling (`COMMUNITY.reactionsPerMinute`); chat reactions have their own (`MESSAGE_SPAM_CEILING.reactionsPerMinute`, 60) so that reacting can never consume the allowance for actually replying, and edits their own again (20/minute). All anti-abuse, all tiers, never a subscription feature.

14.19 Migration `20260922120000_message_replies_edits_reactions` — additive only, and checked against production rather than assumed. One live table changes (`CommunityLike`, one column with a DEFAULT); `Message` and `Conversation` gain nullable columns only, where null reads as "not a reply", "never edited" and "nothing has been reacted to here" — all true of every row already stored. The two new tables are created empty, which is the only reason their `updatedAt` may be NOT NULL, and it still carries a database default because the reaction upserts are raw `ON CONFLICT` statements and raw SQL never goes through Prisma's `@updatedAt`. Both get `ENABLE ROW LEVEL SECURITY`. The enum values are appended, matching `ALTER TYPE ... ADD VALUE`'s own behaviour, so schema and database stay in the same order. Verified by applying it inside one transaction to a database built from the previous 14 migrations and then seeded with production-shaped rows.

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

### 21.5a Photo moderation queue (Phase 13)

`/admin/photos` is where an uploaded photo becomes visible to anyone. Every `ProfilePhoto` row is inserted `PENDING`
(§6), production displays `APPROVED` only (`src/lib/photo-policy.ts`), and the discovery predicate counts *displayable*
photos — so until a human approves two of someone's photos that person is in no deck at all. Before this queue existed
there was no code path in the product that set `APPROVED`, which made every production profile permanently invisible.

- Domain: `src/server/admin/photo-moderation.ts`. `listPendingPhotos` returns the waiting photos newest upload first
  with the member's name, handle, account status, position (0 = their main photo), upload time and how many of their
  photos are already approved, plus a signed one-hour thumbnail URL. `countPendingPhotos` feeds the navigation badge.
- Permission: `photos.moderate`, held by ADMIN and MODERATOR. Reads and writes both call `assertPermission`; the page
  calls `requireAdminPage`, the server action `requireAdmin`. Navigation filtering is cosmetic.
- Decision: `decidePhoto` moves `PENDING → APPROVED | REJECTED` inside a transaction that first locks the row
  (`SELECT id … FOR UPDATE`) and re-reads its state. A photo that is no longer pending is refused with a message
  naming the decision that already stands, so a stale queue in a second tab cannot silently overwrite somebody else's
  call; two simultaneous decisions leave exactly one audit row. Rejection requires a reason. Nobody moderates their
  own photo. Rejected photos are never displayable, never primary and never count towards the minimum of two.
- Audit: `photo.moderated`, target type `ProfilePhoto`, carrying the owner's id, the position, the reason and
  before/after moderation states.
- No schema change: `PhotoModeration` already had all three states and the permission is a TypeScript union.

### 21.6 Audit log

`src/server/admin/audit.ts` is the single writer. Actions: `admin.role.changed`, `admin.bootstrapped`, `user.suspended`, `user.unsuspended`, `user.banned`, `report.decided`, `verification.decided`, `photo.moderated`, `payment.approved`, `payment.rejected`, `subscription.adjusted`, `payment_method.created/updated`, `plan.created/updated` (plus the existing user-initiated `account.deleted` / `account.recreated`). Payloads are sanitised: keys that look like secrets (token, hash, secret, providerSubject, …) are dropped before writing; account numbers are logged as last four digits. `/admin/audit` is read-only and no admin surface can edit or delete rows.

## 22. Staff accounts and the admin portal (member/staff separation)

Mellocrush has two kinds of account and they are mutually exclusive. A **MEMBER** account is a dating account: a
profile, photos, a place in discovery, a Community identity. A **STAFF** account is operational: an address, a
password, a role and an audit trail. One person must never function as both, and the separation is enforced on the
server at every layer rather than by hiding UI.

Before this split, "admin" was a column on a dating account, so an administrator necessarily had a profile that
appeared in Discover like anyone else's. §21 describes the system as it was; this section replaces §21.1 and §21.2.

### 22.1 Account types and routing

`User.accountType` (`MEMBER | STAFF`, default MEMBER) is the domain; `User.role` is the authority layered on a
staff account. The session carries the account type, and `authKindForUser` classifies a staff session as its own
kind, ordered immediately after "blocked" so a staff account can never read as `active`, `onboarding` or
`unverified` anywhere in the app.

That single classification does most of the work:

- `requireActiveUser()` and `requireOnboardingUser()` send a staff session to `/admin`, so no operator ever enters
  dating onboarding and no profile is created for one (§13 of the brief).
- `requireMember()` throws `StaffCannotUseMemberFeaturesError` for a staff session. Every member server action
  goes through it.
- `requireStaff()` / `requireAdmin()` require `accountType = STAFF` **and** an ACTIVE `StaffGrant`. A MEMBER row
  whose `role` column says ADMIN — a stale row, a bad migration, a direct database edit — gets nothing.

Routing: `/admin*` is its own route group in `classifyRoute`, allowed for every auth state because the portal's own
pages decide who may see them. Anonymous visitors reach `/admin/login`; a signed-in member gets the same 404 a
missing page gives, so the portal never confirms it exists; a live staff account gets the dashboard. The signed-in
pages live under `src/app/admin/(dashboard)/`, the sign-in, invitation and password screens outside it.

Onboarding is deliberately **not** required of staff, which is what makes a staff account genuinely profile-less
rather than "a dating profile that is hidden".

### 22.2 Staff authorisation, invitations and the portal

`StaffGrant` (PENDING → ACTIVE → REVOKED) is the single source of truth for portal access, read on every request so
revocation takes effect immediately rather than at the next sign-in. A partial unique index
(`StaffGrant_email_open_key ... WHERE status <> 'REVOKED'`) keeps at most one live grant per normalised address, so
two admins racing on the same address cannot both win; a revoked row is history and frees the address again.

`/admin/staff` (ADMIN only to change anything, visible to any staff account) lists Active and Pending grants and
offers Add staff, Change role, Revoke, Resend invite and Cancel invite. Adding somebody needs only an address, a
role and a reason — they need no Mellocrush account, and none is created until they use the link.

Invitations are `StaffInvite` rows: 32 random bytes, SHA-256 at rest, single-use via a conditional update,
three-day expiry, and issuing one consumes the grant's outstanding invitations so only the newest link works. The
raw token exists in the email and nowhere else — never in the database, the audit log, the admin UI or a log line.

Claiming a link establishes a password and activates the grant. `createStaffAccount` writes a `User` row and
nothing else: no Profile, no PrivacySettings, no DiscoveryPreferences, no Verification. Compare
`src/server/users/account.ts`, which creates all four for a member.

Email ownership (§11 of the brief): the token went to the authorised address, so presenting it is the proof of
control. Nothing links an identity by matching email text. A Google or Telegram identity carrying the same address
is never adopted, and an address that already belongs to a dating MEMBER is refused outright — converting a member
is an administrator's explicit decision, not a side effect of somebody clicking a link.

Portal authentication reuses the member system's primitives rather than inventing a second one: the same scrypt
verifier, the same hashed single-use `AuthToken` rows for resets, the same Postgres rate limiter, the same opaque
database-backed session. What differs is the lifecycle — a staff sign-in additionally requires STAFF plus an ACTIVE
grant, and the member flows additionally refuse a staff identity. Every failure is one sentence, so neither portal
sign-in nor "forgot password" can be used to discover who is staff. Rate limits are tighter than the member ones
(5 sign-in attempts per address per 15 minutes against 10).

A password reset changes a password and nothing else: it never touches `accountType`, `role` or a grant, so a reset
link can never confer staff access.

### 22.3 MEMBER → STAFF conversion

Promotion is never a role change. `src/server/staff/conversion.ts` is an explicit, transactional, audited operation
with three properties:

1. **It reports before it acts.** `inventoryMemberData` counts every member-domain row on an account and
   `planConversion` classifies each as preserved, deleted, detached or anonymised. `scripts/convert-admin-to-staff.ts`
   prints that plan and changes nothing without `--apply`.
2. **It refuses to destroy evidence or relationships.** Likes, matches, conversations, messages, intros, member
   reports, orders, subscriptions, boosts and entitlement overrides are *entanglements*: they involve another
   person, money or a safety record. If an account has any, conversion stops and names them.
3. **It is all-or-nothing**, inside one transaction under the `admin:roles` advisory lock.

Removed: Profile (cascading to photos, interests and prompts), discovery preferences, privacy settings, the
account's own verification record, its passes, its Community reactions, contact hashes, push subscriptions, usage
counters, its notification feed, and its dating attributes on `User` (date of birth, gender, phone, onboarding
completion). Preserved: the `User` row and its id, every sign-in identity, every audit entry, and every
administrative decision the account made. Community posts and comments it wrote are **soft-deleted** rather than
removed, because other people's replies and reactions hang off them.

Stored objects (photos, any verification selfie) are deleted after the transaction commits, never inside it, and a
failure there is logged rather than surfaced: the conversion really did happen, and unreferenced bytes are the
lesser problem.

STAFF → MEMBER is not built. The schema does not prevent it, and the design assumes it would be explicit and would
put the person through fresh onboarding rather than resurrecting old dating state.

### 22.4 The member-domain guard

`requireMember()` in `src/server/auth/current-user.ts` is the choke point every member server action goes through,
and the five route handlers that read the session directly were tightened to match (`/api/photos` accepts active
and onboarding members, `/api/payments/[orderId]/receipt`, `/api/community/posts` and `/api/verification/selfie`
require an active member, and none accepts a staff session).

`src/server/members/guard.ts` adds a second line at the domain layer: `assertMemberAccount` on the write paths that
create dating state — like, pass, send message, add comment, react, boost, start a Plus order, delete account. A
future action, script or job that forgets the request-level guard still cannot make a staff account act as a member.

Staff authority itself is unchanged: ADMIN has every permission, MODERATOR keeps `dashboard.view`, `users.view`,
`users.moderate`, `reports.act`, `verification.act` and `photos.moderate`.

### 22.5 Discovery defence in depth

A staff account has no Profile, so the INNER JOIN in every candidate query already excludes it. That is not treated
as sufficient. `memberOnlySql()` (`u."accountType" = 'MEMBER'`) is part of both canonical visibility fragments —
`baseVisibleSql` (deck, counts, `canView`, likes-you, undo) and `noBlockOrContactSql` (Community feed, comments,
profile-by-handle) — and the two hydrators that turn an id into something a member sees (`buildVisibleProfiles`,
`loadAuthors`) filter on it too. The non-predicate lists that name another person do the same: matches on the Likes
tab, the Discover aside and its activity actors, the chats list and chat header.

A regression test seeds a malformed account that keeps every member row and only flips `accountType`, and asserts it
is still absent from the deck, from `canView` and from the profile hydrator.

### 22.6 Community isolation

Staff cannot create posts, comments or reactions: refused at the action layer by `requireMember()`, at the HTTP
layer by the route's `active` requirement, and in `createPost`/`addComment`/`setReaction` themselves. They are not
rendered as Community authors. Moderation is unaffected and continues to run on staff permissions.

### 22.7 Messaging isolation

Staff cannot create matches, enter conversations, send messages or appear in anyone's Matches or Chats. Conversion
refuses to run while an account has any of those, so the situation should not arise; the chats list and header
filter on account type anyway. Operational communication with a member is not built and would be a separate
mechanism — dating conversations are not to be used for it.

### 22.8 Administrator safety and audit

The project always keeps an administrator. Revoking or demoting takes the `admin:roles` advisory lock and re-counts
live admins inside the transaction, so two concurrent revocations cannot both pass. Nobody may revoke or demote
their own grant. A live administrator is a STAFF account, not deleted or banned, holding an ACTIVE ADMIN grant — the
same definition `requireStaff()` uses, so a leftover MEMBER row with an ADMIN column neither counts nor keeps
bootstrap switched off.

Audited: `staff.invited`, `staff.invite.resent`, `staff.invite.cancelled`, `staff.invite.rejected`,
`staff.claimed`, `staff.activated`, `staff.role.changed`, `staff.revoked`, `staff.password.set`,
`staff.password.reset`, `staff.converted` and `staff.change.rejected`. Refusals are audited *outside* the
transaction that refused: a row written inside an aborted transaction rolls back with it, which is precisely the
case where the record matters most.

No password, verifier, raw invitation token or raw reset token ever reaches the audit log; `sanitizeAuditData`
drops such keys and a test asserts the whole trail contains none of them.

### 22.9 First administrator

`/admin-setup` is unchanged in shape — `ADMIN_BOOTSTRAP_TOKEN`, only while no administrator exists, rate-limited,
constant-time compare — but a successful claim now runs the full conversion and emails a set-password link instead
of setting a role. `scripts/grant-admin.ts` is retired and points at `/admin/staff` and
`scripts/convert-admin-to-staff.ts`.

### 22.10 Re-inviting somebody who was revoked

A revoked grant reserves nothing. `StaffGrant` has two partial unique indexes, and they must stay symmetrical:

| Index | Column | Predicate |
| --- | --- | --- |
| `StaffGrant_email_open_key` | `email` | `status <> 'REVOKED'` |
| `StaffGrant_claimedBy_open_key` | `claimedByUserId` | `claimedByUserId IS NOT NULL AND status <> 'REVOKED'` |

One live grant per address and one live grant per account; any number of revoked ones, which is what keeps the
history readable. `claimedByUserId` is therefore **not** unique on its own, so an account's authority is read with
`findLiveStaffGrant()` (`src/server/staff/live-grant.ts`) and never with `findUnique({ claimedByUserId })` — an
account can hold one live grant and several old ones, and `findUnique` would be a coin toss between them.

This cost a real administrator an evening. `claimedByUserId` originally carried a plain unique index while `email`
carried the partial one, so revoking freed the address but not the account. Re-inviting produced a PENDING grant
that could never be claimed: the claim binds the new grant to the account the person already has, and the revoked
row still held it. Every attempt died with P2002 on `StaffGrant_claimedByUserId_key`.

**The failure was invisible, and that was the worse half.** `staffSetPasswordAction` had no `try`/`catch`, so the
throw reached the form's `.catch(() => null)` and became nothing at all — no message, no error state, just a
spinner that stopped. He clicked twenty times, each one a fresh P2002, until `staff:claim:<ip>` hit its twentieth
attempt and said "Too many attempts. Try again in a little while." That sentence was the first thing the portal
ever told him, and it described neither the problem nor anything he could act on.

Three rules came out of it, and they apply to every unauthenticated portal action:

- **An action that throws must still answer.** `portalFailure()` catches, logs the fault code and stack, and
  returns one plain sentence: "Something went wrong at our end. Nothing was changed. Please try again." The
  diagnostic detail stays in the server log — these actions are unauthenticated, and a code like `P2002` would
  tell a stranger which constraint their input collided with. Saying *that* something failed and that nothing
  changed is the part that was missing; saying *what* failed is for the log. `redirect()` throws by design, so it
  is called *after* the `try` block rather than caught by it.
- **The guard is a ref, not state.** `createSubmitLock()` (`src/lib/submit-lock.ts`) is taken and released
  synchronously, because two submit events in one tick both read a stale `busy`. One click, one request.
- **A 429 starts a cooldown, never a retry.** The rate limiter's `retryAt` reaches the form as
  `retryAfterSeconds`; the form counts it down with the submit button disabled and sends nothing meanwhile. The
  answer to hitting a rate limit is never to raise the limit.

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
| Forged OCR result | The receipt route reads one form field (the file); outcomes, detected values and transaction ids are computed server-side from the stored image and persisted by the server only; a MATCH never activates Plus (§12.14). |
| Receipt privacy | Private bucket, per-attempt server-chosen keys, 5-minute signed URLs, owner/admin only; raw OCR text neither stored nor logged; customer DTO strips sender, transaction number and other orders' data. |
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
TELEGRAM_CLIENT_ID=      # optional pair: BotFather → Login Widget; redirect URI ${APP_URL}/auth/telegram/callback. "Continue with Telegram" is offered only when both are set
TELEGRAM_CLIENT_SECRET=  # server only (not the bot token)
EMAIL_PROVIDER=          # resend (production) | console (development: prints the link to the log, refused in production)
RESEND_API_KEY=          # server only; required with EMAIL_PROVIDER=resend
EMAIL_FROM=              # e.g. "Mellocrush <hello@mellocrush.com>", on a domain verified with the provider
EMAIL_AUTH=on            # off switches email + password sign-in off even when a provider is configured
ADMIN_BOOTSTRAP_TOKEN=   # optional, one-time: first-admin claim at /admin-setup while no admin exists (§21.2); remove after use
STORAGE_PROVIDER=local   # local (dev/test) | supabase
LOCAL_STORAGE_DIR=.storage
PAYMENT_PROVIDER=none
VERIFICATION_PROVIDER=manual
VAPID_PUBLIC_KEY=        # web push (§29). All three together or none at all; unset switches push off entirely
VAPID_PRIVATE_KEY=       # server only. `npx web-push generate-vapid-keys` — ours, generated locally, no account anywhere
VAPID_SUBJECT=           # mailto: or https:// contact a push service can use to reach us about our traffic (RFC 8292)
APP_URL=http://localhost:3000
```

`src/lib/env.ts` validates all of this with Zod at first use and refuses a production boot with `AUTH_PROVIDER=dev`, a missing Google client, or `STORAGE_PROVIDER=local`. `OTP_PEPPER`, `SMS_PROVIDER` and `THUNDI_DEV_OTP_ECHO` no longer exist. Supabase now issues `sb_publishable_*` and `sb_secret_*` keys; the legacy `anon`/`service_role` keys still work until end of 2026 but the code uses the new names.

## 17. Testing strategy

- Unit (Vitest): age calculation across time zones and leap days, phone normalisation, OTP hashing and attempt rules, entitlement derivation, completion percentage, intro week keys.
- Integration (Vitest against Postgres): under-18 rejection at onboarding completion; duplicate like idempotency; mutual like creates exactly one match under concurrency (two parallel transactions); blocked users excluded from deck, likes-you and chat; conversation and message authorization for non-participants; intro quota per week; report creation with snapshot; privacy filtering (hidden location/age, hidden visibility); premium checks for likes-you and advanced filters.
- Monetization (Vitest against Postgres, required): Free allowance is 30 and Plus 90; like consumes, pass does not; 30th succeeds and 31st is rejected with `resetsAt`; allowance restores after the 24-hour window; session/device changes do not reset it; N concurrent likes with one remaining yield exactly one success; expiry of Plus returns the user to Free limits. Messaging (§12.4): a Free sender sends five consecutive messages at the same timestamp; Free↔Free, Free↔Plus and Plus↔Plus are all unlimited; one sender messages several matches at the same instant; Plus lapsing mid-conversation introduces no wait; six concurrent sends all commit; receiving and reading are immediate; the 30/min anti-spam ceiling stops Free and Plus alike and lifts after a rolling minute. Invisible Mode: normal discoverability, hidden from non-liked users, visible after liking, matches unaffected, lapsed Plus fails closed. Likes You: Free receives no identifying fields, Plus receives profiles. Boosts: Plus allowance 2 per 7 days, window enforced, Free rejected.
- Authentication and onboarding (Vitest): ID-token verification against a fake Google JWKS (valid token; wrong issuer, audience, expiry, nonce, unverified email, unknown kid, tampered payload, HS256/none algorithms rejected); authorization request carries PKCE S256, state, nonce and scopes and the exchange posts the verifier and secret; the dev identity provider's codes are bound to redirect URI, nonce and PKCE and expire; production refuses the dev provider and requires the Google client; first sign-in creates one ONBOARDING account with verification NONE and no phone, returning sign-ins map to the same `User.id`, concurrent first sign-ins converge, suspended/banned get no session; deleted accounts are told and only an explicit choice creates a new `User.id` (old row untouched, identity moved, refused when not deleted); recent authentication marks only the requesting session and identity, expires, and is consumed once; deletion refuses without it; users without a phone are discoverable, can view, post and like, and contact blocking still applies through existing lists; session hashing, expiry, revoke one/all; onboarding persistence and resume, exactly-18 accepted and 17y364d refused, DOB absent from public DTOs, required-field gate; photo pipeline rules.
- E2E (Playwright, dev identity provider, scripted outside the repo for now): the full sign-up journey through Continue with Google, forged under-age submission, refresh and forward-jump mid-onboarding, logout and re-login resuming the exact stage, upload errors with retry, reorder/remove, completion to Discover, and every route guard; screenshots at 375/390/430/1280 in light and dark.
- CI: typecheck, lint, unit + integration on a Postgres service container, production build.

## 18. Delivery plan mapping

| Phase | Output |
| --- | --- |
| 3 Database (done) | `prisma/schema.prisma`, migration `20260917152844_init`, seed (reference + dev-only demo data), `src/lib/db.ts`, `prisma.config.ts`, plus the monetization domain layer (`src/config/product.ts`, `src/server/{entitlements,usage,discovery,likes,matching,conversations,boosts,privacy}`) and its database-backed tests. Applied to the hosted Supabase project on 2026-09-17 together with the later migrations (`docs/DEPLOYMENT.md` §3). |
| 4 Design system (done) | `tokens.css`, Tailwind theme, `components/ui/*`, layout shell, preview route `/dev/design-system` in development only. |
| 7 Messaging (done) | `src/server/conversations/{messages,list,unmatch,profile}.ts`, `src/server/safety/report.ts`, `src/actions/messaging.ts`, Chats list, split layout, conversation screen (composer, polling, options/report/block/unmatch sheets), badges from read state, 14 new tests. No migration needed. |
| 6 Discovery + likes + matching (done) | `src/server/discovery/{predicate,query,dto,deck,filters}.ts`, `src/server/locks.ts`, `src/server/safety/block.ts`, hardened `likes/like.ts` and `matching/match.ts`, `src/actions/discovery.ts`, Discover client (deck, filters sheet, full profile, match overlay, like-limit dialog, empty states), `/chats/[conversationId]` shell, development discovery scenarios in the seed, 23 new tests. No migration needed. |
| 5 Auth + onboarding (done) | Migration `20260917170000_onboarding_stage_otp_phone`, `src/server/auth/*`, `src/server/onboarding/*`, `src/server/photos/*`, `src/lib/storage/*`, `src/lib/env.ts`, `proxy.ts`, server actions in `src/actions/*`, routes `/auth/*`, `/onboarding/[stage]`, `/api/photos`, `/api/media`, onboarding and auth components, tests. Hosted Supabase migrated and the private `profile-photos` bucket created with owner approval (`docs/DEPLOYMENT.md`). |
| 8 Community (done) | Migration `20260917200000_community_media_and_comment_reports`, `src/server/community/{dto,feed,posts,reactions,comments,reports,notify,profile}.ts`, `src/server/media/process-image.ts`, `src/actions/community.ts`, `POST /api/community/posts`, Community feed, compose sheet, thread route `/community/[postId]`, safety menus, profile overlay, dev scenario posts in the seed, 12 new tests. |
| 10 Likes You + intros | Likes You grids (Free anonymised / Plus full), intros, Matches tab. |
| 9a Google-only authentication (done) | Migration `20260917230000_google_auth` (AuthIdentity, Session.reauthenticatedAt, optional phone, OtpRequest dropped, PHONE_VERIFIED → NONE), `src/server/auth/{jwt,oidc,identity,recent-auth}.ts`, `src/lib/oauth-cookie.ts`, `/auth/google/{start,callback}`, `/auth/deleted`, `/auth/error`, dev identity provider under `/dev/google`, deletion via Google re-authentication, seeded dev identities, 11 new tests. SMS OTP code, routes, actions and env removed; phone normalisation and hashing kept for contact blocking. |
| 9 Profile, settings, privacy & safety (done) | `src/server/profiles/edit.ts`, photo minimum rule, `src/server/privacy/{settings,contact-hashes}.ts`, `src/server/safety/blocked.ts`, `src/server/notifications/settings.ts`, `src/server/entitlements/presentation.ts`, `src/server/users/deletion.ts`, `verifyOtpCode`, actions `profile/settings/account`, routes `/profile/edit`, `/profile/preview`, `/settings`, `/settings/{privacy,blocked,membership,safety,verification,discovery}`, shared `PhotoManager`, Pause Dating enforcement in likes and deck, 20 new tests (177 total). No migration needed. |
| 11 Admin dashboard + Plus subscriptions (done) | Migration `20260918030000_admin_billing` (plans as admin-managed rows, `PaymentMethod`, `SubscriptionOrder`, `Subscription.orderId`, billing notification types), `src/server/admin/*`, `src/server/billing/*`, actions `admin`/`billing`, `/api/payments/[orderId]/receipt`, `/admin/**` (dashboard, users, payments, methods, plans, subscriptions, reports, verifications, audit), `/admin-setup`, Membership purchase flow and order screen, `scripts/grant-admin.ts`, 38 new tests (209 total). Selfie verification workflow still pending (§11). |
| 11a Receipt OCR (done; hosted migration applied 2026-09-18) | Migration `20260918120000_receipt_ocr` (`ReceiptVerification`, `ReceiptOutcome`), `src/server/ocr/*` (engine, extractors, `bml-v1`/`mib-v1`/`generic-v1` parsers, verifier), `src/server/billing/{receipts,receipt-dto}.ts`, two-step attach/submit flow, admin check panel with Re-run OCR and approve-with-reason, `next.config.ts` OCR asset tracing, 51 new tests (260 total). |
| 10 Plus, verification & entitlement completion (done) | Photo verification end to end (`src/server/verification/*`, `/settings/verification`, `POST /api/verification/selfie`, `/admin/verifications/[userId]`), the Likes tab (`src/server/likes/likes-page.ts`, `/likes`), Boost control, the `PlusLockSheet` lock state, Membership comparison table, accurate HEIC/PDF messages on photo upload, 16 new tests (276 total). No migration. |
| Telegram sign-in (done 2026-09-18; hosted migration applied) | Migration `20260918160000_telegram_auth` (`TELEGRAM` enum value, nullable `AuthIdentity.email`, `AuthIdentity.providerUsername`), `TelegramOidcProvider` beside Google over a shared RS256/JWKS base, `src/server/auth/flow.ts` shared by `/auth/{google,telegram}/{start,callback}`, provider-aware identity mapping and re-authentication, Continue with Telegram on the welcome screen, provider-aware error/deleted/Settings/admin copy, dev stand-in Telegram shape, 12 new tests (288 total). |
| Email + password sign-in (built 2026-09-18; hosted migration and email provider pending owner approval) | Migration `20260918190000_email_auth` (`EMAIL` enum value, `AuthIdentity.passwordHash`/`passwordUpdatedAt`, `AuthToken` table + `AuthTokenPurpose`), `src/server/auth/{password,auth-tokens,email-identity,email-availability}.ts`, `src/lib/email/*`, `src/actions/email-auth.ts`, `/auth/{register,verify,verify-email,forgot-password,reset-password}`, the glass auth shell and fields, unverified enforcement in session/route-access/`requireActor`, admin provider + verification row, 21 new tests (313 total). |
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
- Telegram sign-in is live (migration `20260918160000_telegram_auth` applied 2026-09-18, `docs/DEPLOYMENT.md` §3d). Owner to do: one real Telegram sign-in from a phone to confirm Telegram's side end to end; it creates a new account separate from the Google one.
- **Email + password: the migration is applied** (2026-09-18, `docs/DEPLOYMENT.md` §3e). The remaining gate is a transactional email provider with its DNS records (`docs/DEPLOYMENT.md` §10): until `EMAIL_PROVIDER`, `RESEND_API_KEY` and `EMAIL_FROM` are set in Production, the feature gate hides the email form and `/auth/register` redirects, so Google and Telegram are unaffected. Owner to do: create the Resend account, verify `mellocrush.com` with the four DNS records, add the three variables.
- **Account recovery for an email account whose address is lost** is deliberately not built: changing the address is allowed only while it is still unverified. A verified member who loses access to their inbox has no self-service path yet, and inventing one (support-driven or otherwise) needs the owner's decision on how identity would be proven.
- **Account linking** (one person, several providers) does not exist. Signing in with Google and with email creates two accounts. If one account per person across providers is wanted, it needs an explicit, authenticated "link this method" step while signed in.
- **Contact-blocking leftovers.** The feature was removed from the product on 2026-09-22 (§12), but its data layer is still in place: `ContactHash`, `PrivacySettings.blockContacts`, `User.phoneE164` / `phoneHash`, `src/server/privacy/contact-hashes.ts`, `CONTACT_HASH_SALT`, and the ContactHash join inside `noBlockOrContactSql` which runs on every discovery and Community query and can never match anything now that nothing can write a row. Removing it is a small, deliberate change (predicate + its tests, then a migration dropping the columns) that needs the owner's word on one question: **is a phone number ever going to be collected?** If yes, leave all of it and the feature comes back as a UI change. If no, it should be dropped, because a column nothing can fill is a standing invitation to write code that trusts it.
- Verified phone (optional): sign-in no longer verifies a phone. If the product wants "phone verified" as an independent signal (or wants people to hide from contacts through their own number), an explicit phone step with its own SMS provider decision is needed; nothing is assumed meanwhile.
- Photo moderation before launch: production shows APPROVED photos only (§7.1). Either the moderation/approval workflow (Phase 12) must exist so uploads become APPROVED, or the owner must approve an alternative photo policy. Without one of these, new users will not be discoverable in production.
- Account deletion retention (Phase 9, Google-auth migration): deletion anonymises immediately but keeps the anonymised User row, message history, reports, blocks, subscription records and the scrubbed identity row (Google subject only, so a returning Google account is told its account was deleted) indefinitely because no legal retention period has been decided. The owner (with legal advice) must set how long those records are kept before a purge job is written; no duration was invented.
- **First administrator**: set `ADMIN_BOOTSTRAP_TOKEN` (32+ random characters) in the Vercel Production environment, redeploy, open `/admin-setup` signed in as the owner, enter the token, then remove the variable (§21.2). Alternative: `npx tsx scripts/grant-admin.ts --email <google email>` with database access.
- **Plus prices and bank account**: no prices or bank details exist in code. In `/admin/plans` set the MVR price, switch on "Price approved" and enable each plan to sell; in `/admin/payments/methods` add the bank account and enable it. Nothing is for sale until both are done.
- Automated payment gateway for MVR (BML or equivalent) later: implement a provider that creates a `Subscription` the way `approveOrder` does; orders, plans and entitlements stay as they are.
- Admin-side expiry job: `notifyExpiringSubscriptions` / `markExpiredSubscriptions` exist but nothing schedules them yet (a Vercel cron or similar needs owner approval).
- **Verified badge after photo changes**: approve or amend the policy in §11 before it is implemented (needs a small schema change).
- **Parser calibration**: the BML and MIB parsers follow layouts fixtured from real slips in the AVITO codebase. The first real Mellocrush receipts should be reviewed against the admin check panel; a layout change is a new parser version (`bml-v2`), never a silent edit, and "Re-run OCR" re-reads stored receipts with it.

## 7.5 Dating and Friendship (2026-09-20)

Mellocrush is two products sharing one app. `DiscoveryPreferences.connectionIntent` says which one a member is in,
and the two pools never see each other.

**This is not `RelationshipIntent`.** That enum — SERIOUS_RELATIONSHIP / MARRIAGE / DATING / FIGURING_OUT — is the
romantic "how serious?" question, and `DATING` there means casual rather than "not friendship". Folding Friendship
into it would have destroyed a shipped feature and the stated intent of most live members, so Dating vs Friendship
is a separate field on a separate axis. It is single-select, matching the model that was already there; nothing in
the schema ever allowed two intents at once.

**Three concepts, deliberately distinct** (`src/server/preferences/intent-policy.ts`, the only module that decides
any of this):

| concept | where | how it is set |
|---|---|---|
| gender | `User.gender` | the member states it |
| connection intent | `DiscoveryPreferences.connectionIntent` | the member chooses Dating or Friendship |
| gender preference | `DiscoveryPreferences.interestedIn` | **derived** on Dating, **chosen** on Friendship |

Dating is opposite-gender only, so its preference is not a question: a man is shown women, a woman men. Onboarding
therefore does not ask — a step with one answer should not exist — and no write path reads a Dating preference from
a request. `resolvePreferences` computes it from the gender, so `MAN + DATING + MEN` posted straight at the server
stores WOMEN, and `UNSPECIFIED + DATING` is refused outright (it has no opposite, and the reciprocal rule would show
that member to nobody and nobody to them — an empty deck with no explanation is worse than a clear refusal).

`friendshipInterestedIn` holds the member's own Friendship answer even while they are on Dating. Without it,
switching back and forth would either re-ask every time or, worse, silently adopt the derived Dating value as
though they had chosen it.

**Onboarding branches once**, after GENDER, and both branches are the same length, so the flow is still 11 steps
and the progress treatment is untouched:

    … GENDER → CONNECTION → INTENT → LOCATION …     Dating     (how serious?)
    … GENDER → CONNECTION → MEET   → LOCATION …     Friendship (who would you like to meet?)

`stagesFor()` builds the path and `stepNumber()` derives the "n / 11" from it, because a hard-coded step number
would leave a hole where the other branch's question was. Opening the other branch's URL redirects to where the
member actually is.

**Discovery** gains one clause, in `compatibilitySql` rather than `viewerFilterSql`:

    cp."connectionIntent" = <viewer's connectionIntent>

It compares each side's own intent rather than a preference about the other's, so it is reciprocal by construction
with nothing to keep in step. It sits with compatibility, not with the viewer's filters, because it is not a
preference anyone may relax: a Plus member cannot widen their way across, and a future "show me everyone" filter
cannot reach over it. The existing reciprocal gender clauses need no branch — `interestedIn` always holds the
preference for the active intent, and both sides are already known to share one — so "Friendship → Everyone" works
through exactly the rule dating uses.

**Changing your mind later** goes through the same policy from Edit profile and the filters sheet. A gender change
moves a Dating preference with it and leaves a Friendship one alone: who you want to be friends with does not
change because you corrected your own gender. Friendship → Dating enforces the derived value; Dating → Friendship
asks rather than inheriting.

## 26. The Welcome Screen cover (2026-09-20)

The background of the sign-in screen is admin-managed. Nothing else about that screen changed: the logo, tagline,
glass card, Google, Telegram, email and password, Continue, Forgot password, Create account and the legal line are
all exactly as they were. Only where the photograph comes from is now dynamic.

### Three shapes, not three sizes

`src/server/welcome/variants.ts` is the one place the rules live. One photograph cannot be the right shape for a
phone held upright and a 4K monitor at once, so there are three art directions and the browser picks one:

| Variant | `media` | Recommended upload | Shape |
|---|---|---|---|
| Desktop | `(min-width: 1280px)` | 2560 × 1440 | 16:9 |
| Tablet | `(min-width: 768px)` | 1536 × 2048 | 3:4 |
| Mobile | *(the `<img>` fallback)* | 1080 × 1920 | 9:16 |

768 was already this screen's own breakpoint (the auth card and the backdrop's focal point both move there) and
1280 is the project's canonical `wide` tier. Width alone decides, so a landscape tablet takes the tablet image and
covers it — cropped, never stretched, never letterboxed. `<picture>` runs widest-first and takes the FIRST match, so
the browser downloads exactly one file; `<link rel="preload">` mirrors it with self-contained media queries, because
a preload link does not inherit "everything wider already matched".

`object-fit: cover` plus an intrinsic width and height on every candidate is what makes the image fill any viewport
in any orientation without stretching, without a blank edge and without shifting when it arrives. A blur (built-in
covers) or flat average colour (uploads) is painted behind it so the area is never empty.

### Data

`WelcomeCoverAsset` is one uploaded image with its real dimensions, weight and blurhash. `WelcomeCover` is a
campaign pointing at up to three of them, with a status and an optional window. Assets are separate so an archived
campaign keeps rendering the artwork it published rather than whatever replaced it.

DRAFT, PUBLISHED and ARCHIVED are stored. **Scheduled and expired are not**: a cover with a future `startsAt` is
scheduled and one whose `endsAt` has passed is expired, both derived at read time. Storing them would need a job to
flip the rows, and a job that has not run yet is a promotion that did not start.

### Selection, and what happens when two covers overlap

`getActiveWelcomeCover` (`src/server/welcome/active-cover.ts`) takes PUBLISHED covers whose window contains `now`
and orders them:

1. a cover with a start date beats one without — an explicit promotion beats the evergreen cover
2. the later start date wins
3. the later publish time wins
4. the higher id wins — a total order, so the answer never depends on row order

Exactly one cover can therefore read LIVE; another published, in-window cover reads "Published" rather than claiming
to be on air too. "Restore default" archives every published cover in one action, deleting nothing.

### Falling back per device

Every variant is optional, and a missing one falls back to the built-in default **for that device**. A promotion with
mobile and tablet artwork but no desktop one shows the desktop default on a monitor — never the phone image
stretched across it. The built-ins (`src/server/welcome/defaults.ts`, generated by `scripts/render-hero.mjs`) ship
with the build: no database row, no storage object, no network call. `getActiveWelcomeCover` cannot throw, so a
database that is down or a row pointing at artwork that no longer exists costs the promotion, never the sign-in page.

The three defaults are crops of the one master photograph (941 × 1672, the largest original that exists), positioned
by hand. A landscape master would make the desktop default sharper than a 941px-wide band can be; until there is one,
cropping first still beats letting the browser cover-crop the full portrait frame, which upscales the same pixels and
downloads three times the bytes to do it.

### Upload, preview, publish

Uploading changes nothing a visitor sees. `uploadCoverAsset` attaches artwork to a cover; only `publishWelcomeCover`
puts it on air, and a cover with no artwork at all is refused because publishing it would be indistinguishable from
restoring the defaults. Republishing something expired clears the stale end date, so it does not go live and expire
in the same instant.

Uploads reuse the profile-photo pipeline (`processImage`): sharp sniffs the real format — the browser's MIME type is
never trusted — the allow-list is JPG/PNG/WebP, 8 MB, EXIF including GPS is dropped by the re-encode to WebP, and the
result is capped at the variant's recommended size. A bad aspect ratio or a low resolution is **warned about, not
refused**. `/api/admin/welcome-cover` is a route handler rather than a server action only because a server action's
body is capped well below 8 MB; authorization is identical either way.

### Serving, and why not a signed URL

The storage bucket is private and hands out short-lived signed URLs, which are the wrong shape for the largest image
on the first page a stranger sees: they expire, cannot be cached for long, and putting one in the HTML hands out a
credentialled URL. `GET /api/welcome-cover/<assetId>` reads the bytes server-side instead and serves them
`public, max-age=31536000, immutable`. That is safe because an asset id is minted per upload and its bytes never
change, so new artwork is always a new URL — publishing can never leave a phone showing the old cover. **No new
bucket and no Supabase policy change**: nothing about RLS moves.

The welcome page already awaited two availability checks; the cover query joins the same `Promise.all`, so making the
background dynamic adds no round trip. Publishing takes effect on the next request — no deployment, no cron.

### Authorization

`welcome-cover.manage` is an ADMIN permission; a MODERATOR does not hold it. Every action and the upload route call
`requireAdmin("welcome-cover.manage")`, which re-reads the session and the live `StaffGrant` from the database. The
admin screen hides what a moderator cannot use, but hiding is tidiness. Every change is audited
(`welcome_cover.*`). The preview page is admin-only and noindex because it can show DRAFT artwork, and it is the one
path where `X-Frame-Options` is `SAMEORIGIN` rather than `DENY`: it exists to be framed by the admin screen, and an
iframe is what gives it a real viewport so the breakpoints resolve for the device being previewed rather than for the
laptop looking at it.

## 27. The public legal documents (2026-09-21)

Three documents, supplied by the operator on 21 September 2026 and reproduced verbatim:

| Route | Document |
|---|---|
| `/terms` | Terms & Conditions |
| `/privacy` | Privacy Policy |
| `/community-guidelines` | Community Guidelines |

Root-level addresses, because these are what go on an app-store listing, in an email footer and on a regulator's
form; they should be short and permanent. They live in a `(legal)` route group so the folder can hold a shared
layout without appearing in the URL. All three are statically rendered — no database, no session, nothing to fetch.

**Nothing on these pages is invented.** No registered address, no company number, no clause the operator did not
write. The only editorial decision in the code is the heading structure: one `<h1>`, numbered clauses as `<h2>`, and
no `<h3>` — because the supplied text has two levels and a third would put a structure in the document its author
did not write.

### Access

A fourth route group, `legal`, allowed for anonymous, onboarding and active sessions. That is additive: no existing
route changed group, and the two strictest rules above it are untouched — an unconfirmed email account still reaches
exactly one screen, and a staff account still goes to the portal. The group exists because "public" was not the
right answer: a signed-in member must be able to read the terms they agreed to, and the Safety Center links to the
Community Guidelines from inside the app, where a `public` route would have bounced them to Discover.

`LEGAL_PATHS` is an exact-match set rather than a prefix, so a future member route called `/terms-and-matches` can
never accidentally become public.

### Where they are linked

- The welcome card's "By continuing…" line → `/terms` and `/privacy`, on every signed-out auth screen.
- Each document's own footer → the other two.
- Settings → Support: three real rows, replacing the "Not yet available" placeholders that were there.
- Safety Center → "Read the full Community Guidelines", one tap from the screen people reach when something has
  gone wrong.

`/legal/terms` and `/legal/privacy` were the placeholder addresses and now `permanentRedirect` to the real ones,
because they are already linked from screens people may have bookmarked.

### Reading

One measure, capped so the article is 640px at every width from 768 up and full-width-minus-gutters below it.
Verified at 320, 360, 390, 430, 768, 820, 1024, 1280, 1440 and 1920: no horizontal overflow anywhere, and the
measure never exceeds what is comfortable to read.

## 28. The Android shell (2026-09-21)

A Capacitor 8 wrapper in `mobile/`, isolated from the web app: its own `package.json`, its own lockfile, its own `node_modules`. The website's install, build and deploy never see it.

28.1 Remote, not bundled. The WebView loads `https://www.mellocrush.com` through Capacitor's `server.url`. Bundling local assets would require `output: "export"`, which this application cannot use — 48 of its 57 pages render per request, and it has middleware, sixteen route handlers, fourteen server-action modules and a Postgres database behind them. There is no second backend and no second database; the shell is a window onto the running production app. Because `server.url` is an https origin, the WebView's origin *is* `www.mellocrush.com`, so the existing Secure/SameSite=Lax session cookie, every relative fetch and every server action work unchanged. `X-Frame-Options: DENY` does not apply (it governs framing, not top-level navigation) and there is no CSP to conflict with.

28.2 Navigation is fenced. `allowNavigation` lists `www.mellocrush.com`, `mellocrush.com` and the Supabase storage host that serves signed photo, receipt and selfie URLs. Anything else opens in the system browser rather than living inside the app wearing its chrome. `cleartext: false`, and `android:usesCleartextTraffic="false"` in the manifest.

28.3 Permissions: `INTERNET` only, which is a decision and not an oversight. Reading Capacitor's `BridgeWebChromeClient`: a plain `<input type="file">` goes to `showFilePicker()` → `FileChooserParams.createIntent()`, the system picker, which returns a `content://` URI under a temporary grant — `READ_MEDIA_IMAGES` would add a permission dialog and access to every photo on the device for no gain. And `capture="user"` (the verification selfie) is gated on `isMediaCaptureSupported()`, which returns true when CAMERA is granted **or not declared at all**; leaving it undeclared sends the user to the system camera app under its own permission, while declaring it would make Capacitor demand a runtime grant and fail the selfie if refused. So: no camera permission, no media permission, no runtime prompts.

28.4 The build is entirely cloud-side. `.github/workflows/android-debug-apk.yml`, `workflow_dispatch` only: JDK 21 (Capacitor 8's Android library compiles against 21), Node 22 for the Capacitor CLI alone, `npm ci` in `mobile/`, `cap sync android`, `gradlew assembleDebug`, artifact upload. The website is never installed or built there — the APK carries no web assets — so the job never touches Prisma or tesseract.js. Gradle generates its own debug keystore, so **the workflow needs no secrets** and runs with `permissions: contents: read`.

28.5 The runtime bridge's shapes are read, never assumed. The web app reaches Capacitor through `window.Capacitor.Plugins` rather than importing `@capacitor/app` and `@capacitor/browser`, so those packages stay out of every browser visitor's bundle. The cost is that TypeScript has nothing to check the call signatures against — the declarations in `native-bridge.ts` are this repository's own, and the compiler will believe whatever they say. It did: `App.addListener` was declared as returning a promise, `.then()` was called on it, and the injected bridge returns the handle synchronously (`@capacitor/android/.../assets/native-bridge.js:183`). The TypeError landed in an effect mounted by the ROOT LAYOUT, so it fired on every screen, React rebuilt the tree, and the shell reloaded itself about once a second — indefinitely, on every page, while the website was untouched because the code is behind `isNativeApp()`. The rules that follow from it: every shape in that file is quoted from the injected bridge with a file and line; listeners are synchronous and every other plugin method is a promise via `cap.nativePromise` (:999); and nothing in `listenForAuthDeepLink` may throw, because losing the deep link is a bug and losing the application is an outage. `tests/unit/native-bridge-runtime.test.ts` holds that contract, including the hostile shapes.

28.6 Known limits of the first build. Re-authentication (required before account deletion for OAuth accounts) stays on the web path, because it binds to a session living in the WebView's cookie jar that a Custom Tab cannot see; email accounts re-authenticate by password and are unaffected. Restoring a deleted account is likewise a website journey — the pending-identity cookie would be set in the browser, not the app. Email verification links open in Chrome; the account is verified server-side and the member then signs in inside the app.

## 29. Push notifications (2026-09-22)

External notifications — a phone buzzing while MelloCrush is closed. Web and PWA only in this pass; the Android shell is covered in §29.7 and is blocked on credentials the owner has not supplied.

**29.1 The shape, and why it is this way round.** An event happens; the `Notification` row is written **inside** the event's transaction, exactly as it was before this phase and by the same eleven producers; then, **outside** that transaction, `src/server/notifications/push.ts` asks whether the row deserves a push. Push is never part of the transaction that creates a notification. A push service is a network call to somebody else's machine, and holding a database transaction open across it would make sending a message as slow and as fragile as the slowest push endpoint in the world. So the `Notification` row **is** the queue — the same arrangement the away-email path already uses (§12.16) — and the engine reads from it afterwards.

Two entry points, one evaluator. `pushForRecipient` runs fire-and-forget after a request that raised something, so the common case reaches the phone in about as long as the request took; `sweepPushQueue` is the safety net for the rest — a producer with no request behind it (the billing cron), a request that died before the fire-and-forget ran, and the case worth naming: a member who **was** in the app when it arrived, so nothing was sent, and who has since left without reading it. Both call `pushNotification`, so neither can develop its own idea of the rules. Nothing in the file may throw into a caller: a push is a courtesy and must never fail a message send.

The gates, cheapest and most decisive first: configured → the row exists → a type we know how to push → not stale (30 min) → recipient is an ACTIVE MEMBER → the master switch → the category switch → **not present** → not already read or being read → has devices. The overwhelming majority of notifications cost one row read and stop.

**29.2 A push never carries the content of anything.** Not the message body, not a comment, not a post, not a verification outcome, not a payment reason. A push leaves our servers, is relayed by a service we do not own, and is drawn on a lock screen anybody standing nearby can read and that the operating system keeps in a notification history the member never asked for. The in-app feed is behind a session; a lock screen is not.

This is structural rather than a matter of care. `pushCopyFor` takes a **notification row**, and a notification row has never contained message text — there is no parameter to pass a body through and nothing in `push-copy.ts` reads one. The payload is a closed four-field shape (`title`, `body`, `url`, `tag`) and `tests/integration/push.test.ts` asserts that shape exactly, so a new field carrying event data fails a test before it can reach a lock screen. The wording: "**Hind left you a message 💬** / Open MelloCrush to see it" — *left*, not *sent*, because what was left is waiting to be read, which is both the true thing and the thing that gets somebody to open the app; *sent* invites the reader to expect the message itself.

A push may also never say more than the app would. Whether a liker can be named is a **paywall** question (§12.5: Free members see "Someone liked you"), so no push ever names one — "Someone likes you ❤️ / Open MelloCrush to find out who" — and a Plus member's push says the same, because the alternative is selling the feature on a lock screen. Whether anybody can be named at all is a **block** question, and a suspended or deleted account is never surfaced. All three are decided in `push.ts`, which has the database; `push-copy.ts` is handed `actorName: null` and writes the anonymous line.

**29.3 What the push service can see: nothing.** Web Push (RFC 8291) encrypts the payload with a key pair the *browser* generated and a shared secret only that browser and this server hold; the service relays an opaque blob and learns that an endpoint received something and how big it was. That answers the obvious worry by protocol rather than by trust — and it is explicitly **not** the reason message text is excluded. Text is excluded because a lock screen is not private, and that would still be true if the transport were perfect. VAPID (RFC 8292) is the other half: a keypair identifying this server, generated locally with `npx web-push generate-vapid-keys`. There is no third-party service, no account and no vendor in this design.

**29.4 Idempotency is a constraint, not a convention.** Every send claims `PushDelivery(notificationId, subscriptionId)` — a unique pair — with a single `INSERT … ON CONFLICT … RETURNING id`. No row came back means somebody else already has it, and a caller with no row sends nothing. That one fact covers every duplicate: a retried job, a replayed request, a polling page, a reconnecting client and two concurrent sweeps all race for the same key and the database picks exactly one winner. Nothing counts, compares timestamps or trusts a flag. A `PENDING` row older than five minutes is taken over instead (a process that died mid-send), bounded by `attempts`, and that retry is still the same row.

**29.5 Presence and devices.** "Away" is `User.lastActiveAt` (§12.17), which is persisted server-side, so a tab that closed without telling us is simply a member whose pointer stopped moving — the client is never asked and never believed. "Don't push about a conversation they are reading" is the same idea: `ConversationParticipant.lastReadAt >= notification.createdAt`.

Devices are rows, never a token on the `User` row: a person reasonably has a laptop, a phone browser and later the Android app at once, and a single column would silently drop every one but the last to ask. Re-subscribing is an **upsert on the endpoint**, which is what stops one browser becoming five rows and one person five buzzes; it takes the endpoint over from a previous owner, which is the fix for a handed-down device still pushing the old owner's notifications. A `404`/`410` from a push service means the endpoint will never work again — permission revoked, data cleared, app uninstalled — so it is disabled immediately and never retried; transient failures are counted and disable at five. Disabled rows are kept, so the same browser re-granting permission revives rather than duplicates.

**29.6 Preferences.** A master switch plus six categories — Messages, Likes, Matches, Reactions, Community activity, Account and security — and **every one of them defaults to `false` in the database**, so a member who never touches this is never pushed to. Turning the master switch on brings Messages, Likes and Matches with it, once, and only when the member has expressed no view; they are visible and individually switchable the moment the block expands, so nothing is enabled out of sight, and a member who switched one off gets their own choice back rather than the default. Turning push off does not touch the in-app Notifications feed: everything still arrives in the app. The destination is a path on our own origin and nothing else — no token, no id beyond the one already in the URL bar when the member is on that screen — and it is a **route, not an authorization**: `/chats/<id>` re-runs `getConversationForActor` on arrival, so a stale deep link gets the same NotFound as a typed one.

**29.7 Android.** Not done, and deliberately not begun. The shell is a remote-URL WebView (§28.1), so whether push works there at all is a question about the *WebView's* Push API, not about Capacitor, and the honest answer could not be verified from this sandbox. So `PushSection` **feature-detects** `serviceWorker`, `PushManager` and `Notification` rather than testing a user agent: where the API is absent the block does not appear, and if a future WebView provides it push starts working with no change here. Assuming instead of reading is exactly what cost this app an outage once (§28.5). If FCM turns out to be needed it requires a Firebase project, `google-services.json`, a service-account key and a native rebuild; `PushSubscription.transport` already carries an `FCM` value so the schema does not move when that day comes. **No native file has been touched and no Firebase project exists.**

## 12.16b Match and like emails (2026-09-22)

Two more notification emails on the machinery §12.16 already built for messages: presence decides, the unread notification row is the queue, a `RateLimitBucket` key is the idempotency, and nothing may throw into a caller. Neither creates a notification — both read the rows the in-app feed already writes, so a member with Matches or Likes switched off has no rows and therefore no email, without either sender knowing anything about preferences beyond the one column `resolveEmailRecipient` reads.

**Matches** behave like messages, because a match is a single event: an immediate send from the like path when the other person is away, plus a sweep for the case the send path cannot see — they were in the app when it happened and left without opening it. Only the *target* is kicked immediately; the actor just swiped, so a send for them could only ever answer "present". The email **names nobody**, which is a departure from the message email and deliberate: a message email names a sender the recipient already knows and is already talking to, whereas a match email announces a *new* connection, and that person's name is the interesting part — precisely the part that belongs behind a sign-in rather than in an inbox that may be shared, synced or previewed on a lock screen.

**Likes are a digest, never a stream.** They arrive in bursts, from people the recipient may not be entitled to know about, and one email per like would be the most annoying notification this product could ship. So: at most one email per member per day, counting unread likes that have been waiting at least thirty minutes — long enough that the count has settled and the digest cannot land mid-session. The throttle is keyed on the **member**, not on the likes it happens to be reporting, so a like arriving an hour after a digest cannot produce a second one.

The digest carries **a count and nothing else, for everybody, Plus included**. Who likes you is the paywall (§12.5). Naming them would hand the feature to every Free member's inbox; naming them only for Plus members would put the answer somewhere the entitlement cannot be re-checked when the mail is opened, and a subscription can lapse between sending and reading. A number is true whoever reads it.

**Observability, which §12.16 lacked.** A send that failed returned `"failed"` to a caller that ignored it, and a deployment with no mail provider did nothing at all, silently — indistinguishable from a deployment where nobody happened to be away. Both are now visible: one warning per process for an unconfigured provider, and `console.error` on a genuine failure carrying the kind, the outcome and the internal recipient id. Never an address, never a display name, never a message body — and never the provider's own error object, which can quote the recipient's address back at us.

Failure logging is **bounded by construction** because the throttle is consumed *before* the send is attempted: at most one line per conversation per six hours, per match per week, per member per day. `no-address` is deliberately *not* logged, and that is not an oversight — recipient resolution happens before the throttle, so anything logged there is unbounded, and a Telegram-only account having no address is a permanent expected property rather than a failure. The provider mix is a database question.

## 30. Website analytics (2026-09-22)

First-party traffic measurement, built into the existing admin rather than bought in. No external analytics provider, no advertising network, no third-party script: the measurement happens on our own servers and the data never leaves them.

**30.1 What it answers, and why it is worth a feature.** Before this, the Dashboard could count accounts but nothing at all about the people who arrived and did not sign up — the whole top of the funnel was invisible. Analytics answers who is visiting, where from, on what, which pages they see, and how many of them become members. It is built on three tables and one beacon; nothing about the member-facing product changes.

**30.2 The privacy boundary is `src/lib/analytics/classify.ts`, and it is pure on purpose.** The rule it enforces is REDUCTION, applied before anything is written:

- a **User-Agent** is dozens of identifying bits — enough to single somebody out in a country this size — so it becomes at most three short labels (`MOBILE`, `Chrome`, `Android`) and the original is discarded. Families, never versions: "Chrome 131.0.6778.86" is a fingerprint, "Chrome" is the answer to the only question an operator has;
- a **referring URL** carries a path and a query string, which routinely hold search terms and campaign ids, so it becomes a host;
- a **visited URL** carries ids saying *which* profile or *which* conversation somebody opened, so the query and fragment are dropped and dynamic segments collapse to `:id`. Without that last reduction a "top pages" table would quietly become a log of who read whose messages;
- **country** is a two-letter code from the edge or nothing. The address it was derived from is never read into a variable, let alone stored.

The tables have no `ip` column, no `userAgent` column and no fingerprint column, which is the stronger guarantee: a column that does not exist cannot be filled in later by accident.

**30.3 Ingest.** The browser POSTs `{ eventKey, type, path, referrer }` to `/api/analytics/collect` and nothing else is believed. Who the visitor is, which session this belongs to, whether they are signed in, whether they are staff, what country the edge saw — all resolved server-side from cookies and headers. Both cookies (`mc_vid`, `mc_sid`) are **HttpOnly and server-minted**, so the page cannot read them, a script injected into the page could not steal them, and the client has no identifier to forge. A cookie value is only ever used to *look a row up*; if it matches nothing, a fresh id is minted.

The endpoint answers **204 to everything** — a duplicate, a rate limit, a bad body and a successful write are indistinguishable from outside. An endpoint that reported its own state would be an oracle for probing which visitor ids exist or which event keys are taken.

Rate limiting has an awkward shape here and it is worth stating why. A known visitor is capped per minute on their own id. A caller with **no cookie** cannot be capped individually without reading an address, which is the one thing this feature refuses to do — and the obvious shortcut, minting a visitor and keying the limit on that, is not a limit at all: every request gets a fresh key and writes a row. So the creation of new visitors is capped **as a whole**, and the limit is taken before the row exists. The ceiling sits far above real traffic, the failure mode is an unmeasured visit rather than a broken page, and visitors already holding a cookie draw on their own budget so they are never collateral damage.

**30.4 Duplicates, twice over.** `AnalyticsEvent.eventKey` is UNIQUE and the insert is `ON CONFLICT DO NOTHING` — the same rule the push delivery engine uses (§29.4), for the same reason. The client mints one key per navigation, so a retried request, a redelivered beacon and a page restored from the back-forward cache all collide on one key and one row survives. The client *also* refuses to send twice for the same path, which is what makes React Strict Mode's deliberate double-invocation free rather than merely harmless. The two guards are not redundant: the client one avoids pointless traffic, the database one is the guarantee. A refresh and a genuine navigation both count as new views, because both are.

**30.5 Sessions and retention.** A visit ends after 30 minutes of inactivity, and liveness is read from `VisitorSession.lastSeenAt` rather than from the cookie's own expiry — so a cookie the browser kept too long cannot resurrect a dead visit, and tabs open at once correctly share one. A session cookie presented with a different visitor's cookie is refused rather than adopted; adopting it would splice two people's traffic together.

Raw events are deleted after 90 days by `purgeExpiredAnalytics`, which is idempotent and deletes in bounded batches. It runs from `/api/cron/analytics-retention` **and** from ordinary admin traffic behind a once-a-day gate. The second path is not belt-and-braces fussiness: a cron that was never configured in the hosting dashboard is a cron that never runs (the subscriptions cron has never fired), and a retention promise made in a Privacy Policy must not depend on somebody having ticked a box.

**30.6 Reporting and access.** Every figure is counted from rows at request time, as the Dashboard already does — no stored counters, nothing that can drift. One SQL fragment, `INCLUDED`, carries the staff exclusion into every query so a new panel cannot forget it; exclusion is *sticky*, so an operator who signs in mid-visit retroactively removes the pages they saw beforehand. `analytics.view` is **ADMIN only** and deliberately withheld from MODERATOR: a moderator's job is the safety and verification queues, and this is the one screen where visits by people who never signed in are visible at all.

**30.7 Known limits, stated rather than papered over.** Referrer attribution is best-effort: browsers, in-app webviews and privacy settings all suppress referrers, so `DIRECT` means "we were told nothing" and is a floor for every other source rather than a measure of intent — the screen says so. A person on a phone and a laptop is two visitors. Clearing cookies makes a returning visitor look new. An iPad reports itself as a Mac and counts as desktop, because the alternative is fingerprinting around it. Conversion is approximate for the same reason: visiting on one device and signing up on another is two visitors and one sign-up.
