"use client";

import { useActionState, useState } from "react";
import type { StageFormState } from "@/actions/onboarding";
import { RadioCard, RadioGroup } from "@/components/ui/choice";
import { FormError, SubmitButton } from "./submit-button";

/** Prototype steps 5–7: a list of 52 px radio cards and a Continue CTA enabled once a choice is made. */
export interface ChoiceFormProps {
  name: string;
  label: string;
  options: { value: string; label: string; description?: string }[];
  initial: string | null;
  action: (prev: StageFormState, formData: FormData) => Promise<StageFormState>;
}

export function ChoiceForm({ name, label, options, initial, action }: ChoiceFormProps) {
  const [state, formAction] = useActionState<StageFormState, FormData>(action, {});
  const [value, setValue] = useState<string | null>(initial);
  return (
    <form action={formAction} className="flex flex-1 flex-col gap-3.5" noValidate>
      <input type="hidden" name={name} value={value ?? ""} />
      <RadioGroup label={label}>
        {options.map((o) => (
          <RadioCard key={o.value} label={o.label} description={o.description} selected={value === o.value} onSelect={() => setValue(o.value)} />
        ))}
      </RadioGroup>
      <FormError message={state.error} />
      <div className="mt-auto pt-3">
        <SubmitButton disabled={!value}>Continue</SubmitButton>
      </div>
    </form>
  );
}
