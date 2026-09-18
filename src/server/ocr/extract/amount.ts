/**
 * The transferred amount, in minor units (laari), never as a float.
 *
 * A receipt is full of money: the amount, a fee, the balance left over, a daily limit. Reading the wrong one and
 * telling a customer their receipt is for the wrong sum would be worse than reading nothing. So an amount must be
 * introduced by a label we recognise, and the labels that mean "not what was transferred" are checked FIRST. One
 * addition forced by a real MIB slip: it prints the amount as a heading, "MVR 260.00" alone on its line. A line that is
 * nothing but a currency and a number is taken too, weighted below every real label.
 */
import { normalizeOcrText } from "../text";

export interface AmountMatch {
  amountMinor: number;
  /** As written, for showing back to a person. */
  raw: string;
  currency: string | null;
  label: string;
}

const NOT_THE_AMOUNT = /(AVAILABLE|LEDGER|CLOSING|OPENING|CURRENT|RUNNING)?BALANCE|^FEE|CHARGE|COMMISSION|^TAX|^GST|^VAT|LIMIT|RATE|ACCOUNT|^DATE|^TIME|MOBILE|PHONE|CARD|^REF|TRANSACTION(ID|NO|NUMBER)/;

const AMOUNT_LABELS: Array<{ pattern: RegExp; name: string; weight: number }> = [
  { pattern: /TRANSFERAMOUNT$/, name: "Transfer amount", weight: 100 },
  { pattern: /AMOUNTTRANSFERRED$/, name: "Amount transferred", weight: 100 },
  { pattern: /AMOUNTPAID$/, name: "Amount paid", weight: 96 },
  { pattern: /TOTALAMOUNT$/, name: "Total amount", weight: 94 },
  { pattern: /AMOUNT$/, name: "Amount", weight: 90 },
  { pattern: /DEBITAMOUNT$/, name: "Debit amount", weight: 88 },
  { pattern: /TOTAL$/, name: "Total", weight: 70 },
];

/** Currency codes on Maldivian receipts, including how rufiyaa is abbreviated. Letter-bounded so "MVR199" still matches. */
const CURRENCIES: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /(?<![A-Z])(MVR|MRF|RF)(?![A-Z])/, code: "MVR" },
  { pattern: /(?<![A-Z])(USD|US\$)(?![A-Z])|\$/, code: "USD" },
  { pattern: /(?<![A-Z])(EUR|GBP|INR|LKR|AED|SGD|MYR|THB)(?![A-Z])/, code: "OTHER" },
];

/** A run of digits that reads as money: optional thousands separators, optional one- or two-place decimal. */
const MONEY = /(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;

/** "1,500.00" → 150000 with integer arithmetic only. */
export function toMinorUnits(raw: string): number | undefined {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor <= 0) return undefined;
  return minor;
}

function currencyOn(line: string): string | null {
  for (const entry of CURRENCIES) if (entry.pattern.test(line)) return entry.code === "OTHER" ? (line.match(entry.pattern)?.[1] ?? "OTHER") : entry.code;
  return null;
}

/** A whole line that is only a currency and a number, either order: "MVR 260.00", "199.00 MVR", "RF 199". */
const BARE_AMOUNT = /^(?:(MVR|MRF|RF|USD)\s*([\d,. ]+)|([\d,. ]+)\s*(MVR|MRF|RF|USD))$/;
const BARE_WEIGHT = 60;

export function extractAmount(text: string): AmountMatch | undefined {
  const normalized = normalizeOcrText(text);
  let best: { match: AmountMatch; weight: number } | undefined;

  for (const line of normalized.split("\n")) {
    if (!line) continue;

    const bare = BARE_AMOUNT.exec(line);
    if (bare) {
      const raw = (bare[2] ?? bare[3] ?? "").trim();
      const amountMinor = toMinorUnits(raw);
      if (amountMinor !== undefined && (!best || BARE_WEIGHT > best.weight)) {
        best = { match: { amountMinor, raw, currency: currencyOn(line), label: "Headline" }, weight: BARE_WEIGHT };
      }
      continue;
    }

    const money = MONEY.exec(line);
    if (!money) continue;
    const before = line.slice(0, money.index).replace(/[^A-Z]/g, "").replace(/(MVR|MRF|RF|USD|US)$/, "");
    if (!before) continue;
    if (NOT_THE_AMOUNT.test(before)) continue;
    const label = AMOUNT_LABELS.find((entry) => entry.pattern.test(before));
    if (!label) continue;
    const amountMinor = toMinorUnits(money[1]!);
    if (amountMinor === undefined) continue;
    if (best && label.weight <= best.weight) continue;
    best = { match: { amountMinor, raw: money[1]!, currency: currencyOn(line), label: label.name }, weight: label.weight };
  }
  return best?.match;
}
