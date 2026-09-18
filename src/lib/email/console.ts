/**
 * DEVELOPMENT ONLY — prints the message (and therefore the verification or reset link) to the server log instead of
 * sending it, so the whole flow can be walked through locally without an email account. `src/lib/env.ts` refuses it
 * in production, where a real provider is required before email sign-in is offered at all.
 */
import type { EmailMessage, EmailProvider } from "./provider";

export class ConsoleEmailProvider implements EmailProvider {
  readonly id = "console";
  /** Test hook: every message this provider "sent", newest last. */
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    console.info(`\n──────── email (development) ────────\nto:      ${message.to}\nsubject: ${message.subject}\n\n${message.text}\n─────────────────────────────────────\n`);
  }
}
