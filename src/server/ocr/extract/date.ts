/**
 * When the transfer happened. Banks here print 2026-09-18 14:26:31, 18/09/2026 14:26 and 18 Sep 2026. The raw
 * string is kept for display; a Date is produced only for shapes we recognise, read as Maldives time (UTC+5),
 * day-first for slash and dash forms because that is how Maldivian banks print them.
 */
import { normalizeOcrText } from "../text";

const DATE_LABELS = /^(TRANSACTION|PROCESSED|VALUE|PAYMENT|TRANSFER)?\s*DATE(\s*(\/|&)?\s*TIME)?\b[:\-\s]*(.+)$/;
const DATE_SHAPES = [
  /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?/,
  /\b\d{1,2} [A-Z]{3,9},? \d{2,4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?/,
];

/** The labelled date, "Transaction Date" preferred over "Processed Date" or a bare "Date". */
export function extractTransactionDate(text: string): string | undefined {
  const lines = normalizeOcrText(text).split("\n");
  for (const preferred of [true, false]) {
    for (const line of lines) {
      const labelled = DATE_LABELS.exec(line);
      if (!labelled) continue;
      const isTransaction = labelled[1] === "TRANSACTION" || labelled[1] === "TRANSFER";
      if (preferred !== isTransaction) continue;
      for (const shape of DATE_SHAPES) {
        const found = shape.exec(labelled[4]!);
        if (found) return found[0].trim();
      }
    }
  }
  return undefined;
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, SEPT: 8, OCT: 9, NOV: 10, DEC: 11 };
const MALDIVES_OFFSET_MINUTES = 5 * 60;

function build(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date | null {
  if (m < 0 || m > 11 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const year = y < 100 ? 2000 + y : y;
  if (year < 2000 || year > 2100) return null;
  const utc = Date.UTC(year, m, d, hh, mm, ss) - MALDIVES_OFFSET_MINUTES * 60_000;
  const date = new Date(utc);
  // Reject roll-overs such as 31/02.
  const local = new Date(utc + MALDIVES_OFFSET_MINUTES * 60_000);
  if (local.getUTCMonth() !== m || local.getUTCDate() !== d) return null;
  return date;
}

function time(parts: string | undefined, ampm?: string): [number, number, number] {
  if (!parts) return [0, 0, 0];
  const [h = "0", mi = "0", s = "0"] = parts.split(":");
  let hh = Number(h);
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  return [hh, Number(mi), Number(s)];
}

/** A Date in Maldives time for a recognised shape, else null. Never guesses. */
export function parseMaldivesDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const value = raw.toUpperCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(value);
  if (m) return build(Number(m[1]), Number(m[2]) - 1, Number(m[3]), ...time(m[4]));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?: (\d{1,2}:\d{2}(?::\d{2})?)(?: ?(AM|PM))?)?$/.exec(value);
  if (m) return build(Number(m[3]), Number(m[2]) - 1, Number(m[1]), ...time(m[4], m[5]));
  m = /^(\d{1,2}) ([A-Z]{3,9}) (\d{2,4})(?: (\d{1,2}:\d{2}(?::\d{2})?)(?: ?(AM|PM))?)?$/.exec(value);
  if (m) {
    const month = MONTHS[m[2]!.slice(0, 3)];
    if (month === undefined) return null;
    return build(Number(m[3]), month, Number(m[1]), ...time(m[4], m[5]));
  }
  return null;
}
