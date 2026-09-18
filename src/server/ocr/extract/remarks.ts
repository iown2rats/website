/** The remark / purpose / narration text, as read, for the admin to see beside the receipt. */
import { normalizeOcrText } from "../text";

const REMARK = /^(REMARKS?|REMARK|PURPOSE|NARRATION|DESCRIPTION|PAYMENT DETAILS|NOTE)\b[:\-\s]*(.+)$/;

export function extractRemarks(text: string): string | undefined {
  for (const line of normalizeOcrText(text).split("\n")) {
    const m = REMARK.exec(line);
    if (!m) continue;
    const value = m[2]!.trim();
    if (!value || value === "N/A" || value === "-" || value === "NA") return undefined;
    return value.slice(0, 64);
  }
  return undefined;
}
