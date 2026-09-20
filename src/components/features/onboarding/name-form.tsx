"use client";

import { useActionState, useState } from "react";
import { submitName, type StageFormState } from "@/actions/onboarding";
import { FormError, SubmitButton } from "./submit-button";
import { useDismissableError } from "./use-dismissable-error";

/** Prototype step 3: single 52 px input, 18 px/700, note "Shown on your profile. You can't change it later." */
export function NameForm({ initialName }: { initialName: string }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitName, {});
  const [name, setName] = useState(initialName);
  const { error, dismiss } = useDismissableError(state);
  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <label htmlFor="name" className="sr-only">First name</label>
      <input
        id="name"
        name="name"
        value={name}
        onChange={(e) => { setName(e.target.value); dismiss(); }}
        placeholder="First name"
        autoComplete="given-name"
        maxLength={40}
        autoFocus
        aria-invalid={error ? true : undefined}
        className="h-11.5 rounded-lg bg-surface-muted px-4 text-field text-text outline-none placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
      />
      <p className="text-caption text-text-secondary">{"Shown on your profile. You can't change it later."}</p>
      <FormError message={error} />
      <div className="mt-auto pt-3">
        <SubmitButton disabled={name.trim().length < 2}>Continue</SubmitButton>
      </div>
    </form>
  );
}
