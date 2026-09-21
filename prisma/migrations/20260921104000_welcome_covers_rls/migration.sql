-- Row-level security for the two cover tables.
--
-- Every other table in this database has RLS ENABLED WITH NO POLICIES, which is deny-all for the `anon` and
-- `authenticated` roles that PostgREST uses. Those roles hold full SELECT/INSERT/UPDATE/DELETE grants on every
-- public table, so RLS is the only thing standing between the project's publishable key and the data.
--
-- The 20260920220000_welcome_covers migration created its two tables without it, because Prisma does not manage
-- RLS and the existing tables had been enabled out of band. That left WelcomeCover and WelcomeCoverAsset writable
-- by anyone holding the publishable key — and since /api/welcome-cover serves bytes at whatever storage key the
-- row names, an inserted row could have been used to read a profile photo, a payment receipt or a verification
-- selfie out of the private bucket.
--
-- The application connects as the table owner and is unaffected: owners bypass RLS unless FORCE is set.
--
-- ALREADY APPLIED to production on 2026-09-21 as an incident fix. This file exists so a fresh database, a restore
-- or a branch gets the same posture rather than repeating the hole.
ALTER TABLE "WelcomeCover" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WelcomeCoverAsset" ENABLE ROW LEVEL SECURITY;
