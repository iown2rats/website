"use client";

import { useActionState, useState } from "react";
import { submitPhone, type PhoneFormState } from "@/actions/auth";
import { FormError, SubmitButton } from "@/components/features/onboarding/submit-button";
import { useDismissableError } from "@/components/features/onboarding/use-dismissable-error";

/*
 * Prototype step 1: fixed "🇲🇻 +960" chip (52 px, radius 16) + 7-digit input (18 px/700, tracking .04em,
 * placeholder "7XX XXXX"), note "Your number is never shown on your profile…". Numeric keyboard, digits only.
 */
export function PhoneForm({ initialPhone = "" }: { initialPhone?: string }) {
  const [state, action] = useActionState<PhoneFormState, FormData>(submitPhone, {});
  const [value, setValue] = useState(initialPhone);
  const { error, dismiss } = useDismissableError(state);
  const digits = value.replace(/\D/g, "").slice(0, 7);
  const display = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;

  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <div className="flex gap-2.5">
        <div className="flex h-13 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-body-lg font-bold" aria-hidden="true">
          <span className="text-lg">🇲🇻</span>+960
        </div>
        <label className="sr-only" htmlFor="phone">
          Mobile number (7 digits, after +960)
        </label>
        <input
          id="phone"
          name="phone"
          value={display}
          onChange={(e) => { setValue(e.target.value); dismiss(); }}
          inputMode="numeric"
          autoComplete="tel-national"
          pattern="[0-9 ]*"
          placeholder="7XX XXXX"
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby="phone-note"
          className="h-13 min-w-0 flex-1 rounded-lg border border-border bg-surface px-4 text-input-lg tracking-[.04em] text-text outline-none placeholder:text-text-muted focus:border-primary"
        />
      </div>
      <p id="phone-note" className="text-caption text-text-secondary">
        Your number is never shown on your profile. We use it to keep Thundi Maldives-only.
      </p>
      <FormError message={error} />
      <div className="mt-auto pt-3">
        <SubmitButton disabled={digits.length < 7}>Continue</SubmitButton>
      </div>
    </form>
  );
}
