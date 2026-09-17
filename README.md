# Thundi

Meet someone closer to home. Dating for the Maldives. 18+.

- Design source of truth: `prototype/` (read-only) and `docs/PROTOTYPE_AUDIT.md`
- Architecture and approved product rules: `docs/ARCHITECTURE.md` (monetization in §12)
- Contact blocking design: `docs/CONTACT_BLOCKING.md`

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
THUNDI_SEED_DEMO=true npm run db:seed   # + prototype demo profiles (development only, refused in production)
npm run dev
```

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

Migrations are **not** applied to the hosted Supabase project automatically. See `docs/ARCHITECTURE.md` §5 for the connection strategy; apply with `npm run db:deploy` against `DIRECT_DATABASE_URL` only when instructed.

## Layout

```
prisma/          schema, migrations, seed and seed data
src/config/      product rules (single source of truth for limits and plans)
src/lib/         db client, errors, hashing, age
src/server/      domain layer (entitlements, usage windows, discovery predicate, likes, matching, messages, boosts, privacy)
src/app/         Next.js routes (placeholder until Phase 4/5)
tests/           unit and integration tests
docs/            audit, architecture, contact blocking, prototype reference sheets
```
