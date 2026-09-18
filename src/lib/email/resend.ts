/**
 * Resend (https://resend.com) over its HTTPS API — a plain fetch, no SDK and no native dependency, so nothing has to
 * be traced into the serverless bundle. The API key is server-only and comes from RESEND_API_KEY; the From address
 * comes from EMAIL_FROM and must be on a domain verified in the Resend dashboard (docs/DEPLOYMENT.md §10).
 */
import { EmailDeliveryError, type EmailMessage, type EmailProvider } from "./provider";

const ENDPOINT = "https://api.resend.com/emails";

export class ResendEmailProvider implements EmailProvider {
  readonly id = "resend";
  constructor(private readonly apiKey: string, private readonly from: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async send(message: EmailMessage): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      });
    } catch (e) {
      throw new EmailDeliveryError(e instanceof Error ? e.message : "network");
    }
    if (!res.ok) {
      // The body can quote the recipient address; keep it out of logs and out of the thrown message.
      throw new EmailDeliveryError(`resend ${res.status}`);
    }
  }
}
