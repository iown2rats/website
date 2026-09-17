"use client";

import { useActionState, useState } from "react";
import { submitAbout, type StageFormState } from "@/actions/onboarding";
import { INTEREST_LIMITS, PROMPT_LIMITS } from "@/config/product";
import { Chip } from "@/components/ui/choice";
import { Textarea } from "@/components/ui/field";
import { SectionLabel } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import { FormError, SubmitButton } from "./submit-button";

/*
 * Prototype step 10: bio textarea (3 rows, radius 18), "INTERESTS" label and chip cloud. Prompts follow the
 * prototype's Edit profile → Prompts accordion ("Choose up to 3 prompts…"). Everything here is optional.
 */
export interface AboutFormProps {
  interests: { id: string; label: string }[];
  prompts: { id: string; text: string }[];
  initialBio: string;
  initialInterestIds: string[];
  initialPrompts: { promptId: string; answer: string }[];
}

export function AboutForm({ interests, prompts, initialBio, initialInterestIds, initialPrompts }: AboutFormProps) {
  const [state, action] = useActionState<StageFormState, FormData>(submitAbout, {});
  const [bio, setBio] = useState(initialBio);
  const [selected, setSelected] = useState<string[]>(initialInterestIds);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(initialPrompts.map((p) => [p.promptId, p.answer])));
  const [open, setOpen] = useState<string | null>(null);
  const answered = Object.entries(answers).filter(([, a]) => a.trim().length > 0);

  const toggleInterest = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= INTEREST_LIMITS.max ? s : [...s, id]));

  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <input type="hidden" name="prompts" value={JSON.stringify(answered.map(([promptId, answer]) => ({ promptId, answer: answer.trim() })))} />
      {selected.map((id) => <input key={id} type="hidden" name="interestIds" value={id} />)}

      <label htmlFor="bio" className="sr-only">About you</label>
      <Textarea id="bio" name="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line or two about you" rows={3} maxLength={300} />

      <SectionLabel>Interests</SectionLabel>
      <p className="-mt-2 text-caption text-text-secondary">Pick up to {INTEREST_LIMITS.max} · {selected.length} selected.</p>
      <div className="flex flex-wrap gap-2">
        {interests.map((i) => (
          <Chip key={i.id} selected={selected.includes(i.id)} onClick={() => toggleInterest(i.id)} disabled={!selected.includes(i.id) && selected.length >= INTEREST_LIMITS.max}>
            {i.label}
          </Chip>
        ))}
      </div>

      <SectionLabel className="mt-1">Prompts</SectionLabel>
      <p className="-mt-2 text-caption text-text-secondary">Choose up to {PROMPT_LIMITS.max} prompts and answer them in your own words. Optional.</p>
      <div className="flex flex-col gap-2.5">
        {prompts.map((p) => {
          const answer = answers[p.id] ?? "";
          const has = answer.trim().length > 0;
          const isOpen = open === p.id;
          const canOpen = has || answered.length < PROMPT_LIMITS.max;
          return (
            <div key={p.id} className={cn("shrink-0 overflow-hidden rounded-2xl border-[1.5px] bg-surface", has ? "border-primary" : "border-border")}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => (isOpen ? setOpen(null) : canOpen ? setOpen(p.id) : undefined)}
                className="flex h-13.5 w-full items-center justify-between border-0 bg-transparent px-4.5 text-left text-body font-bold text-text"
              >
                <span>{p.text}</span>
                <span className="text-micro text-primary-pressed">{has ? "Answered" : canOpen ? "Add" : ""}</span>
              </button>
              {isOpen ? (
                <textarea
                  aria-label={p.text}
                  value={answer}
                  maxLength={200}
                  rows={2}
                  autoFocus
                  onChange={(e) => setAnswers((a) => ({ ...a, [p.id]: e.target.value }))}
                  placeholder="Your answer"
                  className="block w-full resize-none border-0 border-t border-border bg-surface-muted px-4.5 py-3.5 text-body leading-normal text-text outline-none"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <FormError message={state.error} />
      <div className="mt-auto pt-3">
        <SubmitButton>Continue</SubmitButton>
      </div>
    </form>
  );
}
