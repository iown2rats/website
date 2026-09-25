"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { isReminderSnoozed, snoozeReminder, VERIFY_HREF, type ReminderStorage } from "@/lib/verification-reminder";

/*
 * The Discover "Get verified" reminder (docs/ARCHITECTURE.md §11.1). A gentle nudge, not an alert: the warm glass
 * card the rest of Discover uses, coral only on the one action, no border, no gold (verification is not Plus).
 *
 * The server decides WHETHER it may appear (src/server/verification/reminder.ts) and only then renders this. Here the
 * member can snooze it for seven days; the snooze lives in this browser under a key the server derived for this
 * member alone. The server snapshot counts as snoozed, so a dismissed reminder never flashes in before hydration.
 */
const noopSubscribe = () => () => {};
function localStore(): ReminderStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function VerificationReminder({ dismissKey }: { dismissKey: string }) {
  const snoozed = useSyncExternalStore(noopSubscribe, () => isReminderSnoozed(localStore(), dismissKey, Date.now()), () => true);
  const [dismissed, setDismissed] = useState(false);
  if (snoozed || dismissed) return null;

  return (
    <section
      aria-label="Get verified"
      data-testid="verification-reminder"
      className="relative mx-auto mt-1 w-full max-w-[var(--deck-max)] shrink-0 rounded-2xl glass-card py-2.5 pl-3.5 pr-11 wide:max-w-[var(--deck-wide)]"
    >
      <div className="flex items-center gap-2.5">
        <h2 className="min-w-0 flex-1 text-body-sm font-medium text-text">Get verified ✨</h2>
        <Link href={VERIFY_HREF} className="inline-flex h-8 shrink-0 items-center rounded-lg bg-primary px-3 text-caption font-medium text-on-primary pressable">
          Verify now
        </Link>
      </div>
      <p className="mt-1 text-caption-sm leading-snug text-text-secondary">
        Stand out with a verified profile and help people feel more confident connecting with you.
      </p>
      {/* 44 px touch target, drawn as a 16 px glyph in the corner. */}
      <button
        type="button"
        aria-label="Dismiss verification reminder"
        onClick={() => {
          setDismissed(true);
          snoozeReminder(localStore(), dismissKey, Date.now());
        }}
        className="absolute right-0 top-0 grid size-11 place-items-center rounded-full border-0 bg-transparent text-text-secondary"
      >
        <CloseIcon size={16} />
      </button>
    </section>
  );
}
