/**
 * Maldivian phone numbers. Mellocrush accepts +960 mobile numbers only.
 * Local mobile numbers are 7 digits starting with 7 or 9. Everything is normalised to E.164 `+960XXXXXXX`
 * so one number can never produce two accounts because of formatting.
 */
export const MALDIVES_DIAL_CODE = "960";

export type PhoneResult = { ok: true; e164: string; local: string } | { ok: false; reason: "EMPTY" | "NOT_MALDIVES" | "INVALID_MOBILE" };

export function normalizeMaldivianPhone(input: string): PhoneResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "EMPTY" };
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/\D/g, "");

  let local: string;
  if (digits.length === 7) local = digits;
  else if (digits.length === 10 && digits.startsWith(MALDIVES_DIAL_CODE)) local = digits.slice(3);
  else if (digits.length > 7 && !digits.startsWith(MALDIVES_DIAL_CODE)) return { ok: false, reason: "NOT_MALDIVES" };
  else return { ok: false, reason: "INVALID_MOBILE" };

  if (!/^[79]\d{6}$/.test(local)) return { ok: false, reason: "INVALID_MOBILE" };
  return { ok: true, e164: `+${MALDIVES_DIAL_CODE}${local}`, local };
}

/** "7XX XXXX" display form of a local number. */
export function formatLocalPhone(e164OrLocal: string): string {
  const local = e164OrLocal.replace(/^\+?960/, "");
  return `${local.slice(0, 3)} ${local.slice(3)}`;
}

/** "+960 •••• 234": what Settings shows. Never the full number. */
export function maskPhone(e164: string): string {
  return `+960 •••• ${e164.slice(-3)}`;
}
