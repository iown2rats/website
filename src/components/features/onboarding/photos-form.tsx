"use client";

import { useActionState } from "react";
import { submitPhotos, type StageFormState } from "@/actions/onboarding";
import { PHOTO_LIMITS } from "@/config/product";
import { PhotoManager } from "@/components/features/profile/photo-manager";
import type { PhotoDto } from "@/server/photos/photos";
import { FormError, SubmitButton } from "./submit-button";

/*
 * Prototype step 9: the shared photo grid (see features/profile/photo-manager.tsx) plus the note "Add at least 2.
 * Your face should be clearly visible in the first." and the Continue button, enabled once the minimum is met and
 * nothing is still uploading. The server re-checks the minimum in confirmPhotos().
 */
export function PhotosForm({ initialPhotos }: { initialPhotos: PhotoDto[] }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitPhotos, {});
  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <PhotoManager
        initialPhotos={initialPhotos}
        className="flex-1"
        note={`Add at least ${PHOTO_LIMITS.min}. Your face should be clearly visible in the first. JPG, PNG or WebP up to 8 MB.`}
        footer={({ activeCount, uploading, busy }) => (
          <>
            <FormError message={state.error} />
            <div className="mt-auto pt-3">
              <SubmitButton disabled={activeCount < PHOTO_LIMITS.min || uploading || busy}>
                {activeCount < PHOTO_LIMITS.min ? `Add ${PHOTO_LIMITS.min - activeCount} more photo${PHOTO_LIMITS.min - activeCount === 1 ? "" : "s"}` : "Continue"}
              </SubmitButton>
            </div>
          </>
        )}
      />
    </form>
  );
}
