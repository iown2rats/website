/**
 * The bank's own transaction / reference number.
 *
 * A receipt is FULL of numbers: the amount, the balance, the account it came from, the date, a phone number. Picking
 * one at random would be worse than finding nothing, because duplicate detection would then key on garbage. So a
 * candidate must be introduced by a label, and anything that looks like money, a date, a time or a Thundi payment
 * reference is thrown out even when it is. (Rules proven on real BML and MIB slips in the AVITO codebase.)
 */
import { digitsIn, lettersOnly, normalizeOcrText } from "../text";

export interface TransactionIdMatch {
  value: string;
  label: string;
  confidence: "high" | "low";
}

const LABELS: Array<{ pattern: RegExp; name: string; weight: number }> = [
  { pattern: /TRANSACTIONREFERENCE(?:NO|NUMBER|ID)?$/, name: "Transaction Reference", weight: 100 },
  { pattern: /TRANSFERREFERENCE(?:NO|NUMBER|ID)?$/, name: "Transfer Reference", weight: 100 },
  { pattern: /PAYMENTREFERENCE(?:NO|NUMBER|ID)?$/, name: "Payment Reference", weight: 100 },
  { pattern: /TRANSACTION(?:ID|NO|NUMBER|CODE)$/, name: "Transaction ID", weight: 95 },
  // MIB prints "Transaction#"; the letters-only projection drops the hash, so the label arrives as bare TRANSACTION.
  { pattern: /TRANSACTION$/, name: "Transaction", weight: 92 },
  { pattern: /(?:^|[^A-Z])TXN(?:REF(?:NO|NUMBER)?|ID|NO|NUMBER)$/, name: "Txn Ref", weight: 95 },
  { pattern: /TRANSFERID$/, name: "Transfer ID", weight: 95 },
  { pattern: /REFERENCE(?:NO|NUMBER|ID)?$/, name: "Reference", weight: 90 },
  { pattern: /(?:^|[^A-Z])(?:RRN|TRACENO|TRACENUMBER|JOURNALNO|RECEIPTNO|SLIPNO)$/, name: "Trace", weight: 85 },
  { pattern: /(?:^|[^A-Z])REF(?:NO|NUMBER|ID)?$/, name: "Ref", weight: 75 },
];

/** Labels that introduce a number which is emphatically NOT a transaction id. Checked first. */
const NEGATIVE = /(?:AMOUNT|BALANCE|ACCOUNT|ACNO|ACCNO|IBAN|CARD|MOBILE|PHONE|CONTACT|FEE|CHARGE|DATE|TIME|OTP|PIN|CVV|REMARKS?|NARRATION|PURPOSE|NOTE|NOTES|MESSAGE|PAYMENTREFERENCE)$/;

const CANDIDATE = /[A-Z0-9][A-Z0-9/-]{3,31}/g;

function looksLikeDate(value: string): boolean {
  return /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(value) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value);
}
function looksLikeAmount(value: string): boolean {
  return /^\d{1,3}(?:,\d{3})+(?:\.\d{2})?$/.test(value) || /^\d+\.\d{2}$/.test(value);
}
function looksLikeTime(value: string): boolean {
  return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
}
/** Thundi's own payment reference is not a bank transaction number, even when the customer typed it into remarks. */
export function isThundiReference(value: string): boolean {
  return /^THU-?[A-Z0-9]{6}$/.test(value.replace(/\s/g, ""));
}

function plausible(value: string): boolean {
  if (value.length < 5 || value.length > 32) return false;
  if (digitsIn(value) < 4) return false;
  if (looksLikeDate(value) || looksLikeAmount(value) || looksLikeTime(value)) return false;
  if (isThundiReference(value)) return false;
  if (/^(?:19|20)\d{2}$/.test(value)) return false;
  return true;
}

const LABEL_TAILS = new Set(["NO", "ID", "REF", "NUM", "NUMBER", "TXN", "TRN", "RRN"]);

/** OCR splits a long identifier across spaces often enough to be worth repairing, but only when the rest of the line is that identifier. */
function joinSplitIdentifier(rest: string): string | undefined {
  const parts = rest.trim().split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return undefined;
  for (const part of parts) {
    if (!/^[A-Z0-9/-]+$/.test(part)) return undefined;
    if (/^[A-Z]{3,}$/.test(part)) return undefined;
  }
  if (/^[A-Z]+$/.test(parts[0]!) && LABEL_TAILS.has(parts[0]!)) return undefined;
  const joined = parts.join("");
  return plausible(joined) ? joined : undefined;
}

function labelledRemainder(line: string): { label: string; weight: number; value: string } | undefined {
  const firstDigit = line.search(/\d/);
  if (firstDigit <= 0) return undefined;
  const splits: Array<[string, string]> = [[line.slice(0, firstDigit), line.slice(firstDigit)]];
  const trailing = /\s([A-Z]{1,3})\s*$/.exec(line.slice(0, firstDigit));
  if (trailing) splits.push([line.slice(0, firstDigit - trailing[0].length), `${trailing[1]} ${line.slice(firstDigit)}`]);
  for (const [head, rest] of splits) {
    const letters = lettersOnly(head);
    if (!letters || NEGATIVE.test(letters)) continue;
    const label = LABELS.find((candidate) => candidate.pattern.test(letters));
    if (!label) continue;
    const joined = joinSplitIdentifier(rest);
    if (joined) return { label: label.name, weight: label.weight - 5, value: joined };
  }
  return undefined;
}

type Candidate = { value: string; label: string; weight: number; distance: number };

/**
 * "Reference BLAZ7288 11340921": OCR put a space inside the number. When everything after a labelled token is digit-led
 * fragments (no words, no second label), the fragments belong to the token and are joined back on. A word or a letter-led
 * token means the line has moved on to another field, and nothing is joined.
 */
function rejoin(value: string, after: string): string {
  const parts = after.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return value;
  if (!parts.every((part) => /^\d[A-Z0-9/-]*$/.test(part))) return value;
  const joined = value + parts.join("");
  return plausible(joined) ? joined : value;
}

function candidatesOnLine(line: string, carriedLabel: { name: string; weight: number } | undefined, distance: number): Candidate[] {
  const found: Candidate[] = [];
  for (const match of line.matchAll(CANDIDATE)) {
    const value = match[0];
    if (!plausible(value)) continue;
    const before = lettersOnly(line.slice(0, match.index));
    if (NEGATIVE.test(before)) continue;
    const label = LABELS.find((candidate) => candidate.pattern.test(before));
    if (label) found.push({ value: rejoin(value, line.slice(match.index! + value.length)), label: label.name, weight: label.weight, distance: 0 });
    else if (carriedLabel && before.length === 0) found.push({ value: rejoin(value, line.slice(match.index! + value.length)), label: carriedLabel.name, weight: carriedLabel.weight - 15, distance });
  }
  const remainder = labelledRemainder(line);
  if (remainder && !found.some((candidate) => candidate.value === remainder.value)) found.push({ ...remainder, distance: 0 });
  return found;
}

function labelOnlyLine(line: string): { name: string; weight: number } | undefined {
  const letters = lettersOnly(line);
  if (!letters || digitsIn(line) > 0) return undefined;
  if (NEGATIVE.test(letters)) return undefined;
  const label = LABELS.find((candidate) => candidate.pattern.test(letters));
  return label ? { name: label.name, weight: label.weight } : undefined;
}

export function extractTransactionId(text: string): TransactionIdMatch | undefined {
  const lines = normalizeOcrText(text).split("\n");
  const all: Candidate[] = [];
  let carried: { name: string; weight: number } | undefined;
  let carriedFrom = -1;
  lines.forEach((line, index) => {
    const distance = carriedFrom >= 0 ? index - carriedFrom : 0;
    const usable = carried && distance > 0 && distance <= 2 ? carried : undefined;
    all.push(...candidatesOnLine(line, usable, distance));
    const own = labelOnlyLine(line);
    if (own) {
      carried = own;
      carriedFrom = index;
    }
  });
  if (all.length === 0) return undefined;
  const score = (c: Candidate) => c.weight - c.distance * 10 + Math.min(c.value.length, 20) + digitsIn(c.value);
  all.sort((a, b) => score(b) - score(a));
  const best = all[0]!;
  return { value: best.value, label: best.label, confidence: best.distance === 0 && best.weight >= 75 ? "high" : "low" };
}

/** Upper-case, no whitespace or separators: the form that is hashed for duplicate detection. */
export function normalizeTransactionId(value: string): string {
  return value.toUpperCase().replace(/[\s\-/]/g, "");
}
