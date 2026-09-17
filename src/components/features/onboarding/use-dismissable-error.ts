"use client";

import { useState } from "react";

/**
 * Server-action error that disappears as soon as the user edits the form again. `useActionState` keeps the last
 * result until the next submission, so without this a corrected field would still show the old message.
 */
export function useDismissableError<S extends { error?: string }>(state: S): { error: string | undefined; dismiss: () => void } {
  const [dismissed, setDismissed] = useState<S | null>(null);
  return { error: dismissed === state ? undefined : state.error, dismiss: () => setDismissed(state) };
}
