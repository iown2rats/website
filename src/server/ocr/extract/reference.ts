/**
 * Mellocrush's own payment reference (THU-XXXXXX, alphabet 23456789ABCDEFGHJKLMNPQRSTUVWXYZ) when the customer put it in the
 * remark. Missing is normal: not every bank layout shows remarks, and OCR often loses them. Present and equal is strong
 * supporting evidence; present and different is flagged for the admin.
 */
import { normalizeOcrText } from "../text";

const ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export interface MellocrushReferenceMatch {
  /** Canonical form THU-XXXXXX as read. */
  value: string;
  /** Every character is in the reference alphabet, so this can be compared exactly. */
  wellFormed: boolean;
}

export function extractMellocrushReference(text: string): MellocrushReferenceMatch | undefined {
  const normalized = normalizeOcrText(text).replace(/\n/g, " ");
  const m = /(?<![A-Z0-9])THU\s*[-_:]?\s*([A-Z0-9]{6})(?![A-Z0-9])/.exec(normalized);
  if (!m) return undefined;
  const code = m[1]!;
  return { value: `THU-${code}`, wellFormed: ALPHABET.test(code) };
}

/** Exact after removing separators → MATCH; one character off → UNCERTAIN (misread, or a neighbour's reference); else MISMATCH. */
export function compareReferences(detected: string, expected: string): "MATCH" | "UNCERTAIN" | "MISMATCH" {
  const a = detected.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const b = expected.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (a === b) return "MATCH";
  if (a.length !== b.length) return "MISMATCH";
  let differences = 0;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) differences += 1;
  return differences === 1 ? "UNCERTAIN" : "MISMATCH";
}
