"use client";

import { useActionState, useState } from "react";
import { submitPrivacy, type StageFormState } from "@/actions/onboarding";
import { PlusTag } from "@/components/ui/badge";
import { Switch } from "@/components/ui/choice";
import { EyeOffIcon } from "@/components/ui/icons";
import { ListGroup, ListRow } from "@/components/ui/surface";
import { FormError, SubmitButton } from "./submit-button";

/*
 * Prototype step 11 "Privacy first": toggles "Hide my location" and "Hide my age". Invisible Mode is Plus-only and
 * is mentioned, not offered, here.
 *
 * The prototype's ocean "Block my contacts" card is GONE (owner decision, 2026-09-22). Contact blocking matches
 * people by their phone number, and Mellocrush does not ask for one — sign-in is Google, Telegram or email, and
 * production holds zero phone numbers and zero contact hashes. The card could therefore never block anybody: it
 * recorded a preference that nothing could act on, and told members their contacts were being matched when no
 * matching was possible. Fourteen people had turned it on. A privacy control that does nothing is worse than no
 * control, because it is believed.
 */
export function PrivacyForm({ initial }: { initial: { hideLocation: boolean; hideAge: boolean } }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitPrivacy, {});
  const [hideLocation, setHideLocation] = useState(initial.hideLocation);
  const [hideAge, setHideAge] = useState(initial.hideAge);

  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <input type="hidden" name="hideLocation" value={hideLocation ? "on" : "off"} />
      <input type="hidden" name="hideAge" value={hideAge ? "on" : "off"} />

      <ListGroup radius="2xl">
        <ListRow asDiv label="Hide my location" meta={undefined} className="py-3.5" trailing={<Switch checked={hideLocation} onCheckedChange={setHideLocation} aria-label="Hide my location" />} />
        <ListRow asDiv label="Hide my age" className="py-3.5" trailing={<Switch checked={hideAge} onCheckedChange={setHideAge} aria-label="Hide my age" />} />
      </ListGroup>
      <div className="-mt-2 px-3.5 text-caption-sm text-text-secondary">
        Hide my location shows nothing instead of your island. Hide my age means others see only your name.
      </div>

      <div className="flex items-center gap-3.5 rounded-2xl glass-card px-3.5 py-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-aqua-soft text-on-aqua-soft"><EyeOffIcon size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium">Invisible Mode</div>
          <div className="text-caption-sm text-text-secondary">Only people you like can discover you. Available with Mellocrush Plus.</div>
        </div>
        <PlusTag />
      </div>

      <FormError message={state.error} />
      <div className="mt-auto pt-3">
        <SubmitButton>Continue</SubmitButton>
      </div>
    </form>
  );
}
