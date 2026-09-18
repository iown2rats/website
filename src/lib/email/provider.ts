/**
 * Transactional email (docs/ARCHITECTURE.md §4.1b). Mellocrush sends exactly two kinds of message — "verify your
 * email" and "reset your password" — so the interface is deliberately one method. No marketing, no newsletters, no
 * third-party tracking pixels.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text is always sent; every client can read it and it keeps the message out of spam folders. */
  text: string;
  html: string;
}

export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor(readonly reason: string) {
    super(`Email delivery failed: ${reason}`);
    this.name = "EmailDeliveryError";
  }
}
