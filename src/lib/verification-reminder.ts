/**
 * The Discover verification reminder's snooze (client-safe, no React), kept apart from the component so it can be
 * tested without a browser.
 *
 * WHO sees the reminder is decided on the server from the member's Verification row
 * (src/server/verification/reminder.ts). This module only remembers that a member pressed ×, for SNOOZE_MS, in this
 * browser: a dismissal is a courtesy, not a permission, so browser storage is enough and no table is needed. The key
 * is supplied by the server and is different for every member, so one account's dismissal on a shared phone never
 * hides another account's reminder.
 */

/** Where "Verify now" goes: the existing verification flow. There is no second one. */
export const VERIFY_HREF = "/settings/verification";

/** How long × keeps the reminder away. */
export const VERIFICATION_REMINDER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReminderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Whether the member snoozed the reminder and the snooze has not run out. Unreadable storage means "not snoozed". */
export function isReminderSnoozed(storage: ReminderStorage | null, key: string, now: number): boolean {
  if (!storage) return false;
  try {
    const until = Number(storage.getItem(key));
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

/** Records a dismissal: hidden until `now + SNOOZE_MS`. Never throws — the caller hides it in memory regardless. */
export function snoozeReminder(storage: ReminderStorage | null, key: string, now: number): void {
  try {
    storage?.setItem(key, String(now + VERIFICATION_REMINDER_SNOOZE_MS));
  } catch {
    /* Private mode or storage disabled: it stays hidden for this visit and may return on the next. */
  }
}
