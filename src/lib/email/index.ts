import { getEnv } from "@/lib/env";
import { ConsoleEmailProvider } from "./console";
import type { EmailProvider } from "./provider";
import { ResendEmailProvider } from "./resend";

export type { EmailProvider, EmailMessage } from "./provider";
export { EmailDeliveryError } from "./provider";
export { ConsoleEmailProvider } from "./console";

let cached: EmailProvider | null = null;

/** The configured provider. `resend` needs RESEND_API_KEY and EMAIL_FROM; `console` is refused in production. */
export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const env = getEnv();
  cached = env.EMAIL_PROVIDER === "resend" ? new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM!) : new ConsoleEmailProvider();
  return cached;
}

/** Test hook. */
export function resetEmailProviderCache(): void {
  cached = null;
}
