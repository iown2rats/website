import { describe, expect, it } from "vitest";
import { isReminderSnoozed, snoozeReminder, VERIFICATION_REMINDER_SNOOZE_MS, type ReminderStorage } from "@/lib/verification-reminder";

/* The seven-day snooze behind the Discover verification reminder's × (src/lib/verification-reminder.ts). */
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 25, 6);
const A = "mc:verify-reminder:aaaaaaaaaaaaaaaaaaaa";
const B = "mc:verify-reminder:bbbbbbbbbbbbbbbbbbbb";

function memoryStorage(): ReminderStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("verification reminder snooze", () => {
  it("is not snoozed until dismissed", () => {
    expect(isReminderSnoozed(memoryStorage(), A, T0)).toBe(false);
  });

  it("dismissing hides it at once", () => {
    const s = memoryStorage();
    snoozeReminder(s, A, T0);
    expect(isReminderSnoozed(s, A, T0)).toBe(true);
  });

  it("stays hidden throughout the seven days", () => {
    const s = memoryStorage();
    snoozeReminder(s, A, T0);
    expect(VERIFICATION_REMINDER_SNOOZE_MS).toBe(7 * DAY);
    expect(isReminderSnoozed(s, A, T0 + DAY)).toBe(true);
    expect(isReminderSnoozed(s, A, T0 + 7 * DAY - 1)).toBe(true);
  });

  it("returns once the seven days are over", () => {
    const s = memoryStorage();
    snoozeReminder(s, A, T0);
    expect(isReminderSnoozed(s, A, T0 + 7 * DAY)).toBe(false);
  });

  it("account A's dismissal does not hide account B's reminder in the same browser", () => {
    const s = memoryStorage();
    snoozeReminder(s, A, T0);
    expect(isReminderSnoozed(s, A, T0 + DAY)).toBe(true);
    expect(isReminderSnoozed(s, B, T0 + DAY)).toBe(false);
  });

  it("broken, missing or throwing storage never hides it and never throws", () => {
    const s = memoryStorage();
    s.data.set(A, "not-a-number");
    expect(isReminderSnoozed(s, A, T0)).toBe(false);
    const throwing: ReminderStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(isReminderSnoozed(throwing, A, T0)).toBe(false);
    expect(() => snoozeReminder(throwing, A, T0)).not.toThrow();
    expect(isReminderSnoozed(null, A, T0)).toBe(false);
  });
});
