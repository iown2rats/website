import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 configuration. The runtime client uses DATABASE_URL (pooled) via the pg adapter
// in src/lib/db.ts; tooling (migrate, seed, studio) uses DIRECT_DATABASE_URL here.
// See docs/ARCHITECTURE.md §5 "Connection strategy on Supabase".
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: url ?? "postgresql://invalid:invalid@localhost:5432/invalid?schema=public",
  },
});
