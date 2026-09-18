/**
 * OCR text, tidied for matching. Unicode punctuation becomes ASCII, runs of spaces collapse, everything upper-cases —
 * bank receipts are upper-case or numeric, so nothing is lost. Line structure is KEPT: which line a number sits on,
 * relative to its label, is most of the signal. (Rules proven on real BML and MIB slips in the AVITO codebase.)
 */
export function normalizeOcrText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[：ː]/g, ":")
    .replace(/[‐-―−]/g, "-")
    .replace(/[⁄∕]/g, "/")
    .replace(/[|¦]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .toUpperCase();
}

/** Letters only, so punctuation and spacing stop mattering to a label: "Ref No." → REFNO. */
export const lettersOnly = (value: string): string => value.replace(/[^A-Z]/g, "");

export const digitsIn = (value: string): number => (value.match(/\d/g) ?? []).length;
