"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitComplete, type StageFormState } from "@/actions/onboarding";
import { SuccessMark } from "@/components/ui/states";
import { ROUTES } from "@/server/auth/route-access";
import { STAGE_META } from "@/server/onboarding/stages";
import { FormError, SubmitButton } from "./submit-button";

const MISSING_LINKS: Record<string, { label: string; slug: string }> = {
  name: { label: "your name", slug: STAGE_META.NAME.slug },
  dob: { label: "your birthday", slug: STAGE_META.DOB.slug },
  gender: { label: "how you identify", slug: STAGE_META.GENDER.slug },
  // Choosing Dating or Friendship is what settles who you'll see, so the fix-up link is that question.
  interestedIn: { label: "what brings you here", slug: STAGE_META.CONNECTION.slug },
  intent: { label: "what you're looking for", slug: STAGE_META.INTENT.slug },
  location: { label: "where you're based", slug: STAGE_META.LOCATION.slug },
  photos: { label: "at least 2 photos", slug: STAGE_META.PHOTOS.slug },
};

/** Prototype step 12: rippling teal check, "Your profile is live…" and "Start discovering". Completion is server-validated. */
export function DoneStep({ completionPercent, missing }: { completionPercent: number; missing: string[] }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitComplete, {});
  const ready = missing.length === 0;
  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <div className="flex flex-col items-center justify-center gap-4 py-6 text-center">
        <SuccessMark />
        {ready ? (
          <p className="max-w-70 text-body text-text-secondary">Your profile is live. Everything you shared is only visible the way you chose.</p>
        ) : (
          <div className="max-w-80 text-body text-text-secondary">
            Almost there. Please add{" "}
            {missing.map((m, i) => {
              const link = MISSING_LINKS[m];
              return (
                <span key={m}>
                  {i > 0 ? (i === missing.length - 1 ? " and " : ", ") : ""}
                  {link ? <Link href={`${ROUTES.onboarding}/${link.slug}`} className="font-medium text-primary-ink">{link.label}</Link> : m}
                </span>
              );
            })}
            .
          </div>
        )}
        <p className="text-caption text-text-secondary">Profile {completionPercent}% complete. You can add more from your Profile tab.</p>
      </div>
      <FormError message={state.error} />
      <div className="mt-auto pt-3">
        <SubmitButton disabled={!ready}>Start discovering</SubmitButton>
      </div>
    </form>
  );
}
