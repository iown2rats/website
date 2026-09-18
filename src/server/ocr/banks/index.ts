/**
 * Bank detection and the parser registry: detectBank() → the bank's parser → normalised fields. An unrecognised
 * receipt still goes through the generic parser so a readable amount or account is not thrown away, but it is marked
 * as such and can never reach a MATCH outcome.
 */
import { normalizeOcrText } from "../text";
import type { BankCode, ParsedReceipt } from "../types";
import { bmlParser } from "./bml";
import { parseCommon } from "./common";
import { mibParser } from "./mib";
import type { BankParser } from "./types";

export const GENERIC_PARSER_VERSION = "generic-v1";

/** Order matters only for a receipt that names two banks (an interbank transfer); the issuing bank tends to be named first. */
export const BANK_PARSERS: readonly BankParser[] = [mibParser, bmlParser];

export function detectBank(text: string): BankCode | null {
  const normalized = normalizeOcrText(text);
  const hits = BANK_PARSERS.filter((p) => p.detect(normalized));
  if (hits.length === 1) return hits[0]!.code;
  if (hits.length === 0) return null;
  // Both named: prefer whichever name appears first in the text.
  return hits.map((p) => ({ p, at: normalized.search(p.code === "MIB" ? /MALDIVES ISLAMIC BANK|MIB|FAISA/ : /BANK OF MALDIVES|BML/) })).sort((a, b) => a.at - b.at)[0]!.p.code;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const bank = detectBank(text);
  const parser = BANK_PARSERS.find((p) => p.code === bank);
  return parser ? parser.parse(text) : parseCommon(text, null, GENERIC_PARSER_VERSION);
}

export { bmlParser, mibParser };
export type { BankParser };
