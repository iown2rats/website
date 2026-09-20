/**
 * Operator CLI: convert a live administrator's dating account into a pure STAFF account
 * (docs/ARCHITECTURE.md §22.3, docs/DEPLOYMENT.md §3c).
 *
 *   npx tsx scripts/convert-admin-to-staff.ts                      # report only, changes nothing
 *   npx tsx scripts/convert-admin-to-staff.ts --user-id <User.id>  # report for one account
 *   npx tsx scripts/convert-admin-to-staff.ts --apply              # perform the conversion
 *   npx tsx scripts/convert-admin-to-staff.ts --apply --no-email   # ... without sending the set-password link
 *
 * Two deliberate properties:
 *
 *  - **It reports before it acts.** With no flags it prints exactly what would be preserved, deleted, detached and
 *    anonymised, and stops. `--apply` is the only thing that writes, and it re-reads and re-prints the plan first.
 *  - **No address is in this file.** The account is resolved from the database by looking for the live
 *    administrator, never by a hardcoded email. If more than one matches, the script refuses and asks for
 *    `--user-id`, so it can never guess which person was meant.
 *
 * After a successful run the account signs in at /admin with the password it chooses from the emailed link. Its
 * old sign-in identity still works and also lands in the portal.
 */
import "dotenv/config";
import { createPrismaClient, type Db } from "../src/lib/db";
import { inventoryMemberData, planConversion } from "../src/server/staff/conversion";
import { previewPromotion, promoteAccountToStaff } from "../src/server/staff/promote";
import { sendStaffInviteEmail } from "../src/server/staff/auth";
import { deleteOrphanedStorage } from "../src/server/staff/storage-cleanup";
import { isStaffRole, type StaffRole } from "../src/server/staff/rules";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

/** The live administrators, by the definition the guards use, plus any legacy MEMBER row still holding the role. */
async function resolveCandidates(db: Db, userId?: string) {
  if (userId) {
    const one = await db.user.findUnique({ where: { id: userId }, select: { id: true, accountType: true, role: true, status: true } });
    return one ? [one] : [];
  }
  return db.user.findMany({
    where: { role: { in: ["ADMIN", "MODERATOR"] }, status: { not: "DELETED" } },
    select: { id: true, accountType: true, role: true, status: true },
    orderBy: { createdAt: "asc" },
  });
}

function heading(text: string): void {
  console.log(`\n${text}\n${"─".repeat(text.length)}`);
}

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL must be set");
  const apply = has("--apply");
  const sendEmail = !has("--no-email");
  const role = (arg("--role") ?? "ADMIN").toUpperCase();
  if (!isStaffRole(role)) throw new Error("--role must be ADMIN or MODERATOR");

  const db = createPrismaClient(url);
  try {
    const candidates = await resolveCandidates(db, arg("--user-id"));
    if (candidates.length === 0) throw new Error("No administrator found. Pass --user-id <User.id> to name one.");
    if (candidates.length > 1) {
      console.error("More than one account holds a staff role. Re-run with --user-id for the one you mean:");
      for (const c of candidates) console.error(`  ${c.id}  ${c.accountType}  ${c.role}  ${c.status}`);
      process.exit(1);
    }
    const target = candidates[0]!;

    heading(`Account ${target.id}`);
    console.log(`  account type : ${target.accountType}`);
    console.log(`  role         : ${target.role}`);
    console.log(`  status       : ${target.status}`);

    if (target.accountType === "STAFF") {
      console.log("\nAlready a staff account. Nothing to do.");
      return;
    }

    const preview = await previewPromotion(db, target.id);
    console.log(`  email        : ${preview.email ?? "(none verified)"}`);

    const inventory = await inventoryMemberData(db, target.id);
    const plan = planConversion(inventory);

    heading("What this conversion would do");
    const width = Math.max(...plan.lines.map((l) => l.what.length), 10);
    for (const line of plan.lines) {
      console.log(`  ${line.treatment.toUpperCase().padEnd(10)} ${line.what.padEnd(width)}  ${String(line.count).padStart(4)}   ${line.why}`);
    }

    if (plan.blockers.length > 0) {
      heading("Blocked: dating history that must be handled by hand first");
      for (const b of plan.blockers) console.log(`  ${b.what.padEnd(width)}  ${String(b.count).padStart(4)}   ${b.why}`);
      console.log("\nNothing was changed.");
      process.exit(1);
    }
    if (preview.blockedReason) {
      console.log(`\nBlocked: ${preview.blockedReason}`);
      console.log("Nothing was changed.");
      process.exit(1);
    }

    if (!apply) {
      heading("Report only");
      console.log("  Nothing was changed. Re-run with --apply to perform the conversion.");
      return;
    }

    heading("Applying");
    const result = await promoteAccountToStaff(db, target.id, {
      role: role as StaffRole,
      reason: "Converted to a dedicated staff account",
      via: "cli",
      // An operator with database access, not a signed-in admin. Audited with a null actor and the CLI marker.
      actorId: null,
    });
    console.log(`  converted    : ${result.userId}`);
    console.log(`  role         : ${result.role}`);
    console.log(`  grant        : ${result.grantId}`);

    await deleteOrphanedStorage(result.orphanedStorageKeys);
    console.log(`  storage      : ${result.orphanedStorageKeys.length} object(s) removed`);

    if (sendEmail) {
      await sendStaffInviteEmail(result.email, result.token, result.expiresAt, { setup: true });
      console.log(`  set-password : emailed to ${result.email} (expires ${result.expiresAt.toISOString()})`);
    } else {
      console.log("  set-password : not sent (--no-email). Use \"Forgot password?\" at /admin/login instead.");
    }

    heading("Verifying");
    const after = await db.user.findUniqueOrThrow({ where: { id: result.userId }, select: { accountType: true, role: true, status: true, onboardingCompletedAt: true } });
    const remaining = await inventoryMemberData(db, result.userId);
    const checks: [string, boolean][] = [
      ["account exists", true],
      ["account type is STAFF", after.accountType === "STAFF"],
      ["role is preserved", after.role === role],
      ["status is ACTIVE", after.status === "ACTIVE"],
      ["no dating profile", remaining.profile === 0],
      ["no profile photos", remaining.profilePhotos === 0],
      ["no discovery preferences", remaining.discoveryPreferences === 0],
      ["no own verification record", remaining.verification === 0],
      ["not an onboarded member", after.onboardingCompletedAt === null],
      ["audit history preserved", remaining.auditEntries >= inventory.auditEntries],
      ["admin decisions preserved", remaining.ordersDecided === inventory.ordersDecided && remaining.verificationsReviewed === inventory.verificationsReviewed],
      ["sessions revoked", remaining.sessions === 0],
      ["sign-in identity kept", remaining.identities >= inventory.identities],
    ];
    let ok = true;
    for (const [label, passed] of checks) {
      console.log(`  ${passed ? "ok  " : "FAIL"}  ${label}`);
      ok &&= passed;
    }
    if (!ok) {
      console.error("\nOne or more post-conditions failed. Investigate before signing in.");
      process.exit(1);
    }
    console.log("\nDone. Sign in at /admin with the new password.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
