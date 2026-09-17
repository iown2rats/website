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
    CONTACT_HASH_SALT: z.string().min(32, "CONTACT_HASH_SALT must be at least 32 characters"),
    /**
     * Sign-in is Google-only. `google` talks to Google's OIDC endpoints and needs the OAuth client below.
     * `dev` is a local stand-in identity provider (same code path: PKCE, state, nonce, signed ID token) for
     * development and tests; production refuses it.
     */
    AUTH_PROVIDER: z.enum(["google", "dev"]).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().default(".storage"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET_PHOTOS: z.string().default("profile-photos"),
    /** Which photo moderation states other users may see (src/lib/photo-policy.ts). Defaults per NODE_ENV. */
    PHOTO_VISIBILITY_POLICY: z.enum(["approved-only", "approved-and-pending"]).optional(),
  })
  .transform((env) => ({
    ...env,
    AUTH_PROVIDER: env.AUTH_PROVIDER ?? (env.NODE_ENV === "production" ? ("google" as const) : ("dev" as const)),
    PHOTO_VISIBILITY_POLICY: env.PHOTO_VISIBILITY_POLICY ?? (env.NODE_ENV === "production" ? ("approved-only" as const) : ("approved-and-pending" as const)),
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.PHOTO_VISIBILITY_POLICY !== "approved-only") {
        ctx.addIssue({ code: "custom", path: ["PHOTO_VISIBILITY_POLICY"], message: "Production may only display APPROVED photos; PENDING photos need a moderation workflow or an approved alternative policy" });
      }
      if (env.AUTH_PROVIDER !== "google") {
        ctx.addIssue({ code: "custom", path: ["AUTH_PROVIDER"], message: "Production sign-in must use Google (AUTH_PROVIDER=google); the development identity provider is refused" });
      }
      if (env.STORAGE_PROVIDER === "local") {
        ctx.addIssue({ code: "custom", path: ["STORAGE_PROVIDER"], message: "Local disk storage is not allowed in production" });
      }
    }
    if (env.AUTH_PROVIDER === "google" && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["AUTH_PROVIDER"], message: "AUTH_PROVIDER=google needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" });
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

/** Test hook: clears the cache so a test can change process.env between cases. */
export function resetEnvCache(): void {
  cached = null;
}
