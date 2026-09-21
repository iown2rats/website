-- Android OAuth handoff (docs/ARCHITECTURE.md §4.1c).
--
-- Additive only: one new table, nothing existing is touched. The web sign-in flow is unchanged by this migration
-- and by the code that reads the table — a row is only ever written when a request explicitly asked for the
-- Android handoff, which the website never does.
--
-- No secret is stored here. `codeHash` and `challengeHash` are SHA-256 digests; the code exists in exactly one
-- deep link for at most two minutes and one redemption, and the verifier never leaves the app until it is
-- presented for that redemption. There is no session token in this table: the session is created when the code is
-- redeemed, inside the app's WebView.
-- CreateTable
CREATE TABLE "AuthHandoff" (
    "id" TEXT NOT NULL,
    "codeHash" BYTEA NOT NULL,
    "challengeHash" BYTEA NOT NULL,
    "userId" TEXT NOT NULL,
    "landing" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthHandoff_codeHash_key" ON "AuthHandoff"("codeHash");

-- CreateIndex
CREATE INDEX "AuthHandoff_userId_idx" ON "AuthHandoff"("userId");

-- CreateIndex
CREATE INDEX "AuthHandoff_expiresAt_idx" ON "AuthHandoff"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthHandoff" ADD CONSTRAINT "AuthHandoff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security. Every table in this database is RLS-enabled with no policies, so the anon and authenticated
-- roles reachable with the public Supabase key can read and write nothing. A new table that skips this is a hole
-- in that wall, and this table indexes authentication material.
ALTER TABLE "AuthHandoff" ENABLE ROW LEVEL SECURITY;
