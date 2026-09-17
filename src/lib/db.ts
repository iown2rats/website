import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
/** The client type available inside `$transaction` callbacks. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/** Anything that can run queries: the root client or an open transaction. */
export type DbLike = Db | Tx;

/**
 * Creates a Prisma client bound to a Postgres connection string through the pg driver adapter
 * (required by Prisma 7). Used by the app singleton and by tests (one client per throwaway database).
 */
export function createPrismaClient(connectionString: string, options?: { maxConnections?: number }): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: options?.maxConnections ?? 5 });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __thundiPrisma?: PrismaClient };

/** Application singleton. Reads DATABASE_URL (pooled). Never import this from client components. */
export function getDb(): PrismaClient {
  if (!globalForPrisma.__thundiPrisma) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForPrisma.__thundiPrisma = createPrismaClient(url);
  }
  return globalForPrisma.__thundiPrisma;
}
