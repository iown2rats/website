import { z } from "zod";

/**
 * Server environment, validated once. Import only from server code.
 * Production refuses development-only switches (docs/ARCHITECTURE.md §4.1).
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1).optional(),
    DIRECT_DATABASE_URL: z.string().min(1).optional(),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    OTP_PEPPER: z.string().min(32, "OTP_PEPPER must be at least 32 characters"),
    CONTACT_HASH_SALT: z.string().min(32, "CONTACT_HASH_SALT must be at least 32 characters"),
    SMS_PROVIDER: z.enum(["console", "none"]).default("console"),
    STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().default(".storage"),
    THUNDI_DEV_OTP_ECHO: z.enum(["true", "false"]).optional(),
    APP_URL: z.string().url().default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET_PHOTOS: z.string().default("profile-photos"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.THUNDI_DEV_OTP_ECHO === "true") {
        ctx.addIssue({ code: "custom", path: ["THUNDI_DEV_OTP_ECHO"], message: "THUNDI_DEV_OTP_ECHO must not be set in production" });
      }
      if (env.SMS_PROVIDER === "console") {
        ctx.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "The console SMS provider is not allowed in production" });
      }
      if (env.STORAGE_PROVIDER === "local") {
        ctx.addIssue({ code: "custom", path: ["STORAGE_PROVIDER"], message: "Local disk storage is not allowed in production" });
      }
    }
    if (env.STORAGE_PROVIDER === "supabase" && (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["STORAGE_PROVIDER"], message: "Supabase storage needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** True only outside production and when explicitly enabled: the OTP is echoed to the client for local testing. */
export function isDevOtpEchoEnabled(): boolean {
  const env = getEnv();
  return env.NODE_ENV !== "production" && env.THUNDI_DEV_OTP_ECHO === "true";
}

/** Test hook: clears the cache so a test can change process.env between cases. */
export function resetEnvCache(): void {
  cached = null;
}
