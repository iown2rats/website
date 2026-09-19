"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { submitDob, type StageFormState } from "@/actions/onboarding";
import { Select } from "@/components/ui/field";
import { Callout } from "@/components/ui/alert";
import { ageFromDateOfBirth, MINIMUM_AGE } from "@/lib/age";
import { FormError, SubmitButton } from "./submit-button";
import { useDismissableError } from "./use-dismissable-error";

/*
 * Prototype step 4: three selects (Day / Month / Year; years from currentYear−18 downwards), live line
 * "You're N. That's what people will see." or "You must be 18 or older to use Mellocrush.", and the aqua callout.
 * The live line is a hint only: the server recomputes eligibility.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function DobForm({ initial }: { initial: { day: number; month: number; year: number } | null }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitDob, {});
  const [pending, startTransition] = useTransition();
  const { error, dismiss } = useDismissableError(state);
  const [day, setDay] = useState(initial ? String(initial.day) : "");
  const [month, setMonth] = useState(initial ? String(initial.month) : "");
  const [year, setYear] = useState(initial ? String(initial.year) : "");
  const thisYear = new Date().getUTCFullYear();
  const years = useMemo(() => Array.from({ length: 83 }, (_, i) => thisYear - MINIMUM_AGE - i), [thisYear]);

  const age = useMemo(() => {
    if (!day || !month || !year) return null;
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (d.getUTCDate() !== Number(day)) return null;
    return ageFromDateOfBirth(d);
  }, [day, month, year]);
  const adult = age != null && age >= MINIMUM_AGE;

  return (
    <form
      action={action}
      // Dispatching the action manually keeps React from resetting the form (and blanking the controlled selects)
      // when the server rejects the date; the `action` prop remains for no-JS submission.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-1 flex-col gap-3.5"
      noValidate
    >
      <div className="grid grid-cols-3 gap-2.5">
        <Select name="day" aria-label="Day" placeholder="Day" value={day} onChange={(e) => { setDay(e.target.value); dismiss(); }}>
          {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </Select>
        <Select name="month" aria-label="Month" placeholder="Month" value={month} onChange={(e) => { setMonth(e.target.value); dismiss(); }}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
        <Select name="year" aria-label="Year" placeholder="Year" value={year} onChange={(e) => { setYear(e.target.value); dismiss(); }}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
      {age != null ? (
        <p className={adult ? "text-body-sm font-medium text-primary-ink" : "text-body-sm font-medium text-danger"} role="status">
          {adult ? `You're ${age}. That's what people will see.` : `You must be ${MINIMUM_AGE} or older to use Mellocrush.`}
        </p>
      ) : null}
      <Callout>{"Mellocrush is 18+ only. Your age is shown, your birthday isn't."}</Callout>
      <FormError message={error} />
      <div className="mt-auto pt-3">
        <SubmitButton disabled={!adult} loading={pending}>Continue</SubmitButton>
      </div>
    </form>
  );
}
