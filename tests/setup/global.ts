/**
 * Vitest global setup: creates a throwaway database on the TEST_DATABASE_URL server, applies the
 * Prisma migrations to it, and hands the URL to test workers. Dropped again on teardown.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export default async function setup(project: TestProject) {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) throw new Error("TEST_DATABASE_URL is required to run integration tests");
  const dbName = `thundi_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const client = new Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  const dbUrl = withDatabase(admin, dbName);
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DIRECT_DATABASE_URL: dbUrl, DATABASE_URL: dbUrl },
  });

  project.provide("dbUrl", dbUrl);

  return async () => {
    const c = new Client({ connectionString: admin });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await c.end();
  };
}
