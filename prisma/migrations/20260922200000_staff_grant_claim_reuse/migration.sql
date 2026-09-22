-- A revoked grant must stop reserving the account that held it.
--
-- `claimedByUserId` carried a PLAIN unique index, while `email` carried a PARTIAL one that excludes REVOKED rows
-- (`StaffGrant_email_open_key`). That asymmetry was the bug: revoking a grant freed the address but not the
-- account, so re-inviting the same person produced a PENDING grant they could never claim — claiming updates the
-- new grant's `claimedByUserId` to the account they already have, and the revoked row still held that value.
-- Every attempt died on `StaffGrant_claimedByUserId_key` with P2002.
--
-- The fix makes the two columns agree: one LIVE grant per account, any number of revoked ones. The invariant the
-- code relies on ("an account never holds two live grants") is unchanged and still enforced by the database.

DROP INDEX "StaffGrant_claimedByUserId_key";

CREATE UNIQUE INDEX "StaffGrant_claimedBy_open_key"
  ON "StaffGrant" ("claimedByUserId")
  WHERE "claimedByUserId" IS NOT NULL AND "status" <> 'REVOKED';
