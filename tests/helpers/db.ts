import { inject } from "vitest";
import { createPrismaClient, type Db } from "@/lib/db";

let client: Db | null = null;

/** One client per worker, generous pool so concurrency tests are not throttled by the pool itself. */
export function testDb(): Db {
  if (!client) client = createPrismaClient(inject("dbUrl"), { maxConnections: 20 });
  return client;
}

/** Truncates every application table. Reference data is recreated by factories as needed. */
export async function resetDb(db: Db = testDb()): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
