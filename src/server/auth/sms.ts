/**
 * SMS provider abstraction (docs/ARCHITECTURE.md §4.1).
 *
 * WHERE THE REAL GATEWAY CONNECTS: implement `SmsProvider` in a new file (e.g. `sms-dhiraagu.ts`) and
 * return it from `getSmsProvider()` for `SMS_PROVIDER=<gateway id>`. Credentials go in env (documented in
 * .env.example when the provider is chosen). Nothing else in the codebase changes.
 */
import { getEnv } from "@/lib/env";

export interface SendOtpInput {
  /** E.164 destination, e.g. +9607771234 */
  to: string;
  code: string;
  expiresInMinutes: number;
}

export interface SmsProvider {
  readonly id: string;
  sendOtp(input: SendOtpInput): Promise<void>;
}

/** Development only: prints the code to the server log. Refused by env validation in production. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly id = "console";
  async sendOtp({ to, code, expiresInMinutes }: SendOtpInput): Promise<void> {
    console.info(`[thundi:sms:dev] OTP for ${to.slice(0, 4)}•••${to.slice(-3)}: ${code} (valid ${expiresInMinutes} min)`);
  }
}

/** Production placeholder until a gateway is selected: fails loudly rather than pretending a message was sent. */
export class NotConfiguredSmsProvider implements SmsProvider {
  readonly id = "none";
  async sendOtp(): Promise<void> {
    throw new Error("SMS provider not configured. Set SMS_PROVIDER once a gateway has been selected.");
  }
}

/** Test double that records what would have been sent. */
export class MemorySmsProvider implements SmsProvider {
  readonly id = "memory";
  readonly sent: SendOtpInput[] = [];
  async sendOtp(input: SendOtpInput): Promise<void> {
    this.sent.push(input);
  }
}

let cached: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  const env = getEnv();
  switch (env.SMS_PROVIDER) {
    case "console":
      cached = new ConsoleSmsProvider();
      break;
    case "none":
      cached = new NotConfiguredSmsProvider();
      break;
  }
  return cached;
}
