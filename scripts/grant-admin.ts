/**
 * Superseded (docs/ARCHITECTURE.md §22.2).
 *
 * This script used to set `User.role` for one account. Since the member/staff split that is no longer a
 * meaningful operation: staff authority comes from a StaffGrant, and an account cannot hold one while it is still
 * a dating account. Granting a role in place would have produced exactly the arrangement the split removes.
 *
 * What to use instead:
 *   - a brand-new colleague     → /admin/staff → "Add staff". They receive an invitation and choose their own
 *                                 password; no dating profile is ever created for them.
 *   - an existing member        → /admin/users/<id> → "Convert to staff", which reports what will be removed
 *                                 before it does anything.
 *   - the first administrator,
 *     or an operator with only
 *     database access           → npx tsx scripts/convert-admin-to-staff.ts
 */
console.error(
  [
    "scripts/grant-admin.ts has been replaced.",
    "",
    "Staff access is a StaffGrant, not a role column, and an account must be converted out of the dating",
    "domain before it can hold one. Use one of:",
    "",
    "  /admin/staff                              add a colleague by email (they choose their own password)",
    "  /admin/users/<id> → Convert to staff      promote an existing member, with a report first",
    "  npx tsx scripts/convert-admin-to-staff.ts convert an administrator from the command line",
    "",
    "See docs/ARCHITECTURE.md §22.2.",
  ].join("\n"),
);
process.exit(1);
