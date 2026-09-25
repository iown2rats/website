/**
 * Super Like wording and counting for the browser (docs/ARCHITECTURE.md §12.20). Client-safe: no server imports.
 * Everything here is presentation; the server decides entitlement, allowance and message validity.
 */
import { SUPER_LIKE } from "@/config/product";

/** "4 days", "1 day", "5 hours", "1 hour", "less than an hour". Rounds UP, so a reset is never promised early. */
export function formatResetIn(ms: number): string {
  if (ms < 3_600_000) return "less than an hour";
  if (ms < 86_400_000) {
    const h = Math.ceil(ms / 3_600_000);
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const d = Math.ceil(ms / 86_400_000);
  return d === 1 ? "1 day" : `${d} days`;
}

export interface SuperLikeAllowanceView {
  limit: number;
  remaining: number;
  resetsAt: string | null;
}

/** "3 of 5 Super Likes left" and, while a window is open, "Resets in 4 days". */
export function superLikeAllowanceText(a: SuperLikeAllowanceView, nowMs: number): { left: string; reset: string | null } {
  const left = `${a.remaining} of ${a.limit} Super Like${a.limit === 1 ? "" : "s"} left`;
  const until = a.resetsAt ? Date.parse(a.resetsAt) - nowMs : 0;
  return { left, reset: a.resetsAt && until > 0 ? `Resets in ${formatResetIn(until)}` : null };
}

/** The length the server will count: code points of the trimmed text, so one emoji is one character. */
export function superLikeMessageLength(text: string): number {
  return [...text.trim()].length;
}

export const SUPER_LIKE_MESSAGE_MAX = SUPER_LIKE.messageMaxLength;
