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
    /**
     * Optional second provider: Telegram's OpenID Connect service (BotFather → Login Widget). "Continue with
     * Telegram" is offered only when both are set; with AUTH_PROVIDER=dev the local stand-in serves it instead.
     */
    TELEGRAM_CLIENT_ID: z.string().min(1).optional(),
    TELEGRAM_CLIENT_SECRET: z.string().min(1).optional(),
    /**
     * Email + password sign-in (docs/ARCHITECTURE.md §4.1b). It is offered only when transactional email can
     * actually be delivered, because an account that cannot receive its verification link is a dead end:
     * `resend` needs RESEND_API_KEY and EMAIL_FROM; `console` prints the link to the server log and is refused in
     * production. EMAIL_AUTH=off switches the whole method off even when a provider is configured.
     */
    EMAIL_PROVIDER: z.enum(["resend", "console"]).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    /** RFC 5322 From address on a domain verified with the provider, e.g. `Mellocrush <hello@mellocrush.com>`. */
    EMAIL_FROM: z.string().min(3).optional(),
    EMAIL_AUTH: z.enum(["on", "off"]).default("on"),
    /**
     * Shared secret for /api/cron/*. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`, and any other
     * scheduler can do the same. Unset means the endpoints refuse every request rather than standing open — the
     * sweep still runs off ordinary traffic, so an unscheduled deployment loses timeliness, never the feature.
     */
    CRON_SECRET: z.string().min(16).optional(),
    STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().default(".storage"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_STORAGE_BUCKET_PHOTOS: z.string().default("profile-photos"),
    /**
     * One-time first-admin bootstrap (src/server/admin/bootstrap.ts): a signed-in user who presents this token
     * becomes ADMIN, only while no admin exists. Remove the variable after use.
     */
    ADMIN_BOOTSTRAP_TOKEN: z.string().min(32, "ADMIN_BOOTSTRAP_TOKEN must be at least 32 characters").optional(),
    /** Which photo moderation states other users may see (src/lib/photo-policy.ts). Defaults per NODE_ENV. */
    PHOTO_VISIBILITY_POLICY: z.enum(["approved-only", "approved-and-pending"]).optional(),
    /*
     * Web Push (docs/ARCHITECTURE.md §29). A VAPID keypair identifies THIS SERVER to the push services; it is
     * generated once with `npx web-push generate-vapid-keys` and belongs to us — there is no account anywhere and
     * no third party is involved in issuing it.
     *
     * The public key is not secret (browsers receive it to create a subscription) but is NOT prefixed
     * NEXT_PUBLIC_: it is handed to the client by a server action alongside the rest of the push state, so the
     * key and the question "is push even configured here?" are answered together. Unset means push is switched
     * off entirely — subscribing is refused and nothing is ever sent — which is what keeps every environment
     * without keys, including local development and the test database, silent by default.
     */
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    /** `mailto:` or `https:` contact a push service can use to reach us about our traffic. Required by RFC 8292. */
    VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "VAPID_SUBJECT must be a mailto: or https:// URL").optional(),
  })
  .transform((env) => ({
    ...env,
    EMAIL_PROVIDER: env.EMAIL_PROVIDER ?? (env.NODE_ENV === "production" ? undefined : ("console" as const)),
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
      if (env.EMAIL_PROVIDER === "console") {
        ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "The console email provider only prints to the log; production needs a real provider (EMAIL_PROVIDER=resend)" });
      }
    }
    if (env.AUTH_PROVIDER === "google" && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["AUTH_PROVIDER"], message: "AUTH_PROVIDER=google needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" });
    }
    if (!!env.TELEGRAM_CLIENT_ID !== !!env.TELEGRAM_CLIENT_SECRET) {
      ctx.addIssue({ code: "custom", path: ["TELEGRAM_CLIENT_ID"], message: "Telegram sign-in needs both TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET (or neither)" });
    }
    // All three or none. A half-configured keypair would fail at the moment somebody grants permission, which is
    // the worst possible time to find out.
    const vapid = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].filter(Boolean).length;
    if (vapid !== 0 && vapid !== 3) {
      ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "Web push needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together (or none of them)" });
    }
    if (env.EMAIL_PROVIDER === "resend" && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM" });
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

/**
 * Whether email + password sign-in is configured at all: the method is switched on and a provider that can really
 * deliver is set. The database must also carry the migration; `src/server/auth/email-availability.ts` checks both.
 */
export function emailAuthConfigured(env: Env = getEnv()): boolean {
  if (env.EMAIL_AUTH === "off") return false;
  if (env.EMAIL_PROVIDER === "resend") return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  return env.EMAIL_PROVIDER === "console" && env.NODE_ENV !== "production";
}

/**
 * Whether the app can deliver mail at all.
 *
 * Deliberately NOT emailAuthConfigured: that one asks whether email+password SIGN-IN is offered, and EMAIL_AUTH=off
 * turns the method off without saying anything about the mailer. A notification still needs sending when sign-in
 * happens to be Google-only, so the two questions get two functions.
 */
/**
 * Whether web push can work at all here. False in local development and in tests unless keys are set, which is
 * why nothing in the test suite can accidentally reach a real push service.
 */
export function webPushConfigured(env: Env = getEnv()): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function emailDeliveryConfigured(env: Env = getEnv()): boolean {
  if (env.EMAIL_PROVIDER === "resend") return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
  return env.EMAIL_PROVIDER === "console" && env.NODE_ENV !== "production";
}

/**
 * Whether "Continue with Telegram" is offered. Real Telegram needs the BotFather client; the development identity
 * provider stands in for it the same way it does for Google.
 */
export function telegramLoginEnabled(env: Env = getEnv()): boolean {
  return env.AUTH_PROVIDER === "dev" || (!!env.TELEGRAM_CLIENT_ID && !!env.TELEGRAM_CLIENT_SECRET);
}

/** Test hook: clears the cache so a test can change process.env between cases. */
export function resetEnvCache(): void {
  cached = null;
}
