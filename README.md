# Thundi

Meet someone closer to home. Dating for the Maldives. 18+.

- Design source of truth: `prototype/` (read-only) and `docs/PROTOTYPE_AUDIT.md`
- Architecture and approved product rules: `docs/ARCHITECTURE.md` (monetization in §12)
- Contact blocking design: `docs/CONTACT_BLOCKING.md`
- Design system and per-phase visual verification: `docs/DESIGN_SYSTEM.md`

## Stack

Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS 4, Prisma 7 on PostgreSQL 17 (Supabase), Zod 4, Vitest 5.

## Local development

Requirements: Node 22.18+, a PostgreSQL 16+ server you can create databases on (local install or Docker).

```bash
npm install                       # also runs prisma generate
cp .env.example .env              # fill in DATABASE_URL / DIRECT_DATABASE_URL / TEST_DATABASE_URL
createdb thundi_dev               # or: psql -c 'CREATE DATABASE thundi_dev'
npm run db:migrate                # applies prisma/migrations to DIRECT_DATABASE_URL
npm run db:seed                   # reference data only (locations, interests, prompts, placeholder plans)
THUNDI_SEED_DEMO=true npm run db:seed   # + prototype demo profiles and discovery scenarios (development only, refused in production)
npm run dev
```

Demo logins (after the demo seed): `+960 700 0010` is the prototype's Ismail (Free), `+960 700 0011` is a Plus account (Undo, boosts, advanced filters). The other demo numbers are the profiles they discover; `prisma/seed-data/discovery-scenarios.ts` lists which rule each one exercises.

Signing in locally: `SMS_PROVIDER=console` prints the code to the server log and `THUNDI_DEV_OTP_ECHO=true` shows it on the code screen. Photos are stored under `LOCAL_STORAGE_DIR` (`.storage`, git-ignored) and served through signed `/api/media` URLs. Both switches are refused when `NODE_ENV=production`.

Photo visibility: outside production, pending (unmoderated) photos are displayable so uploads can be tested; production shows approved photos only and refuses `PHOTO_VISIBILITY_POLICY=approved-and-pending`. See `src/lib/photo-policy.ts` and `docs/ARCHITECTURE.md` §7.1 for the launch requirement.

Next 16 only serves dev assets to the origin it is bound to, so open `http://localhost:3000` (not `127.0.0.1`) when checking pages in a browser.

If you have Docker: `docker run -d --name thundi-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 postgres:17` and use `postgresql://postgres@localhost:5432/thundi_dev`.

## Checks

```bash
npm run typecheck
npm run lint
npm test          # creates a throwaway database on TEST_DATABASE_URL, migrates it, runs unit + integration tests, drops it
npm run build
```

Integration tests run against a real Postgres and include concurrency tests for the like allowance, message cooldown, boosts and matching. They do not touch `DATABASE_URL`.

## Hosted database

Migrations are **not** applied to the hosted Supabase project automatically. See `docs/ARCHITECTURE.md` §5 for the connection strategy; apply with `npm run db:deploy` against `DIRECT_DATABASE_URL` only when instructed. Before switching `STORAGE_PROVIDER=supabase`, a private bucket named by `SUPABASE_STORAGE_BUCKET_PHOTOS` (`profile-photos`) must exist and `SUPABASE_SECRET_KEY` must be set on the server only.

## Layout

```
prisma/          schema, migrations, seed and seed data
src/config/      product rules (single source of truth for limits and plans)
src/lib/         db client, env validation, errors, hashing, age, cookies, storage providers, validation schemas
src/server/      domain layer (auth, onboarding, photos, profiles, entitlements, usage windows, discovery, likes, matching, conversations, safety, community, media, boosts, privacy)
src/actions/     server actions (auth, onboarding, photos, discovery, messaging, community)
src/components/  ui primitives, layout shell, feature components (auth, onboarding, discovery, chats, community)
src/app/         Next.js routes: /, /auth/*, /onboarding/[stage], (app)/* incl. /chats/[conversationId] and /community/[postId], /api/photos, /api/media, /api/community/posts, /dev/design-system
src/proxy.ts     cookie-presence route guard and security headers
tests/           unit and integration tests
docs/            audit, architecture, contact blocking, prototype reference sheets
```
