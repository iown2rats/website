/**
 * Who sent it and who received it. Names are the softest field on a receipt (OCR mangles them, banks abbreviate
 * them), so they are read for a person to look at and used only as supporting evidence, never as an account match.
 */
import { normalizeOcrText } from "../text";

const FROM = /^(FROM|SENDER|PAYER|DEBIT ACCOUNT NAME)(?: NAME)?\b[:\-\s]*(.+)$/;
const TO = /^(TO|BENEFICIARY|RECIPIENT|PAYEE|CREDIT ACCOUNT NAME)(?: NAME)?\b[:\-\s]*(.+)$/;

function asName(value: string): string | undefined {
  const cleaned = value.replace(/[^A-Z0-9 &.'-]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) return undefined;
  if (/^[\d\s-]+$/.test(cleaned)) return undefined;
  if (/^ACCOUNT( (NUMBER|NO|NAME))?$/.test(cleaned)) return undefined;
  return cleaned;
}

export interface Parties {
  senderName?: string;
  recipientName?: string;
}

export function extractParties(text: string): Parties {
  const lines = normalizeOcrText(text).split("\n");
  const parties: Parties = {};
  for (const line of lines) {
    if (!line) continue;
    const from = FROM.exec(line);
    if (from && !parties.senderName) parties.senderName = asName(from[2]!);
    const to = TO.exec(line);
    if (to && !parties.recipientName) parties.recipientName = asName(to[2]!);
  }
  return parties;
}

/** Letters only, upper-case, legal-form suffixes dropped, so "Mellocrush Pvt Ltd" and "MELLOCRUSH PRIVATE LIMITED" agree. */
export function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|PLC|INC|CO|COMPANY)\b/g, " ")
    .replace(/[^A-Z]/g, "");
}

/** Supporting evidence only: does the recipient name on the receipt agree with the account holder we expect? */
export function namesAgree(detected: string, expected: string): boolean {
  const a = normalizeName(detected);
  const b = normalizeName(expected);
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.includes(b) || b.includes(a);
}
