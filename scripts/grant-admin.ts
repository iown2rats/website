/**
 * Operator CLI: grant or change a role for one account, audited.
 *   npx tsx scripts/grant-admin.ts --email owner@example.com [--role ADMIN|MODERATOR|USER]
 *   npx tsx scripts/grant-admin.ts --user-id <User.id> [--role ADMIN]
 * Uses DIRECT_DATABASE_URL (or DATABASE_URL). Nothing is hard-coded; the email is matched against the Google
 * sign-in identity and must resolve to exactly one non-deleted account.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/db";
import { grantRoleFromCli, ROLES, type Role } from "../src/server/admin/bootstrap";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL must be set");
  const role = (arg("--role") ?? "ADMIN").toUpperCase() as Role;
  if (!ROLES.includes(role)) throw new Error(`--role must be one of ${ROLES.join(", ")}`);
  const email = arg("--email")?.trim().toLowerCase();
  const userId = arg("--user-id");
  if (!email && !userId) throw new Error("Pass --email <google email> or --user-id <User.id>");

  const db = createPrismaClient(url);
  try {
    let targetId = userId;
    if (!targetId) {
      const identities = await db.authIdentity.findMany({ where: { email, releasedAt: null, user: { status: { not: "DELETED" } } }, select: { userId: true } });
      if (identities.length !== 1) throw new Error(`Expected exactly one account for that email, found ${identities.length}`);
      targetId = identities[0]!.userId;
    }
    const result = await grantRoleFromCli(db, targetId, role);
    console.log(`user ${targetId}: ${result.before} → ${result.after} (audited)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
