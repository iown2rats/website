/**
 * Mellocrush's transactional emails, in its voice: short, one action, no marketing. All are sent as plain text with
 * a simple HTML version on the warm-white brand surface; no images, no tracking pixels, no external stylesheet.
 */
import type { EmailMessage } from "./provider";

const BRAND = "Mellocrush";
const COLORS = { page: "#FFFBF1", text: "#3B2F2A", secondary: "#806C67", coral: "#FD7979" } as const;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shell(heading: string, body: string, action: { label: string; url: string }, footer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORS.text}">
<div style="max-width:520px;margin:0 auto">
<p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.02em">${BRAND}</p>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;letter-spacing:-0.02em">${escape(heading)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${COLORS.secondary}">${escape(body)}</p>
<p style="margin:0 0 24px"><a href="${escape(action.url)}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:${COLORS.coral};color:${COLORS.text};font-size:15px;font-weight:700;text-decoration:none">${escape(action.label)}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${COLORS.secondary}">Or paste this link into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all"><a href="${escape(action.url)}" style="color:${COLORS.text}">${escape(action.url)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:${COLORS.secondary}">${escape(footer)}</p>
</div></body></html>`;
}

export function verificationEmail(url: string, expiresInHours: number): Omit<EmailMessage, "to"> {
  const heading = "Confirm your email";
  const body = `Confirm this address to finish setting up your ${BRAND} account.`;
  const footer = `This link works once and expires in ${expiresInHours} hours. If you didn't create a ${BRAND} account, ignore this email and nothing happens.`;
  return {
    subject: `Confirm your email · ${BRAND}`,
    text: `${heading}\n\n${body}\n\n${url}\n\n${footer}`,
    html: shell(heading, body, { label: "Confirm email", url }, footer),
  };
}

export function passwordResetEmail(url: string, expiresInMinutes: number): Omit<EmailMessage, "to"> {
  const heading = "Reset your password";
  const body = `Choose a new password for your ${BRAND} account.`;
  const footer = `This link works once and expires in ${expiresInMinutes} minutes. If you didn't ask to reset your password, ignore this email — your password stays as it is.`;
  return {
    subject: `Reset your password · ${BRAND}`,
    text: `${heading}\n\n${body}\n\n${url}\n\n${footer}`,
    html: shell(heading, body, { label: "Reset password", url }, footer),
  };
}

/**
 * Staff invitation, and the same template in "set your password" mode for an administrator who already has an
 * account. Operational in tone: no dating language, no marketing, one action.
 */
export function staffInviteEmail(url: string, expiresInHours: number, setup: boolean): Omit<EmailMessage, "to"> {
  const heading = setup ? `Set your ${BRAND} admin password` : `You've been invited to the ${BRAND} Admin Portal`;
  const body = setup
    ? `Choose a password for your ${BRAND} Admin Portal account. You'll use it with this email address to sign in at the portal.`
    : `Someone at ${BRAND} has given this address access to the Admin Portal. Choose a password to finish setting up the account.`;
  const footer = `This link works once and expires in ${expiresInHours} hours. If you weren't expecting it, ignore this email — nothing is set up until the link is used, and no ${BRAND} dating profile is created either way.`;
  return {
    subject: setup ? `Set your admin password · ${BRAND}` : `Your ${BRAND} Admin Portal invitation`,
    text: `${heading}\n\n${body}\n\n${url}\n\n${footer}`,
    html: shell(heading, body, { label: setup ? "Set password" : "Set up account", url }, footer),
  };
}

export function staffPasswordResetEmail(url: string, expiresInMinutes: number): Omit<EmailMessage, "to"> {
  const heading = "Reset your admin password";
  const body = `Choose a new password for your ${BRAND} Admin Portal account.`;
  const footer = `This link works once and expires in ${expiresInMinutes} minutes. If you didn't ask to reset your password, ignore this email — your password stays as it is.`;
  return {
    subject: `Reset your admin password · ${BRAND}`,
    text: `${heading}\n\n${body}\n\n${url}\n\n${footer}`,
    html: shell(heading, body, { label: "Reset password", url }, footer),
  };
}

/**
 * "You have a message waiting." Sent only when a message is still unread a while after it arrived
 * (docs/ARCHITECTURE.md §12.13).
 *
 * It deliberately does NOT carry the message. An inbox is read over shoulders, synced to laptops and screenshotted
 * by people other than its owner, and what two matches say to each other is theirs. The email carries who wrote and
 * a way back, which is all it needs to do its job.
 */
export function newMessageEmail(fromName: string, url: string, more: number): Omit<EmailMessage, "to"> {
  const heading = more > 0 ? `${fromName} and ${more} other${more === 1 ? "" : "s"} messaged you` : `${fromName} sent you a message`;
  const body = `You have unread messages on ${BRAND}. Open the app to read and reply.`;
  const footer = `You're getting this because message notifications are on. You can turn them off in Settings → Notifications.`;
  return {
    subject: more > 0 ? `You have unread messages · ${BRAND}` : `${fromName} sent you a message · ${BRAND}`,
    text: `${heading}\n\n${body}\n\n${url}\n\n${footer}`,
    html: shell(heading, body, { label: "Open Mellocrush", url }, footer),
  };
}
