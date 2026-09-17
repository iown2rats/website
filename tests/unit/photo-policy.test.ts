import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "@/lib/env";
import { displayablePhotoStates, displayablePhotoWhere } from "@/lib/photo-policy";

const original = process.env.NODE_ENV;
afterEach(() => {
  Object.assign(process.env, { NODE_ENV: original });
  delete process.env.PHOTO_VISIBILITY_POLICY;
  resetEnvCache();
});

describe("photo visibility policy", () => {
  it("shows APPROVED and PENDING outside production by default, never REJECTED", () => {
    resetEnvCache();
    expect(displayablePhotoStates()).toEqual(["APPROVED", "PENDING"]);
    expect(displayablePhotoWhere()).toEqual({ moderation: { in: ["APPROVED", "PENDING"] } });
  });

  it("can be tightened explicitly in development", () => {
    process.env.PHOTO_VISIBILITY_POLICY = "approved-only";
    resetEnvCache();
    expect(displayablePhotoStates()).toEqual(["APPROVED"]);
  });

  it("defaults to APPROVED only in production and refuses to boot with PENDING enabled", () => {
    Object.assign(process.env, { NODE_ENV: "production", AUTH_PROVIDER: "google", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", STORAGE_PROVIDER: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" });
    resetEnvCache();
    expect(displayablePhotoStates()).toEqual(["APPROVED"]);
    process.env.PHOTO_VISIBILITY_POLICY = "approved-and-pending";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/PHOTO_VISIBILITY_POLICY/);
    Object.assign(process.env, { NODE_ENV: original, STORAGE_PROVIDER: "local" });
  });
});
