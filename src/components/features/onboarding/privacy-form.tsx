"use client";

import { useActionState, useState } from "react";
import { submitPrivacy, type StageFormState } from "@/actions/onboarding";
import { PlusTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { EyeOffIcon, ShieldIcon } from "@/components/ui/icons";
import { ListGroup, ListRow, OceanCard } from "@/components/ui/surface";
import { FormError, SubmitButton } from "./submit-button";

/*
 * Prototype step 11 "Privacy first": ocean "Block my contacts" card, then toggles "Hide my location" and "Hide my age".
 * Honest web UX (docs/CONTACT_BLOCKING.md §2, §7): the browser cannot read an address book, so the card records the
 * preference and explains that full contact blocking arrives with the Mellocrush app; no fake permission dialog and no
 * fabricated counts. Invisible Mode is Plus-only and is mentioned, not offered, here.
 */
export function PrivacyForm({ initial }: { initial: { hideLocation: boolean; hideAge: boolean; blockContacts: boolean } }) {
  const [state, action] = useActionState<StageFormState, FormData>(submitPrivacy, {});
  const [hideLocation, setHideLocation] = useState(initial.hideLocation);
  const [hideAge, setHideAge] = useState(initial.hideAge);
  const [blockContacts, setBlockContacts] = useState(initial.blockContacts);

  return (
    <form action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <input type="hidden" name="hideLocation" value={hideLocation ? "on" : "off"} />
      <input type="hidden" name="hideAge" value={hideAge ? "on" : "off"} />
      <input type="hidden" name="blockContacts" value={blockContacts ? "on" : "off"} />

      <OceanCard>
        <span className="grid size-11 place-items-center rounded-md bg-surface text-accent"><ShieldIcon size={22} /></span>
        <div className="text-h4 text-text">Block my contacts</div>
        <p className="text-body-sm leading-relaxed text-text">
          {"People you block from your contacts won't be shown your dating profile, and you won't see theirs. Numbers are hashed on your device and never stored in plain text."}
        </p>
        <p className="text-caption text-text-secondary">
          Full address-book blocking is available in the Mellocrush app. On the web you can add numbers to hide from later in Privacy &amp; Safety.
        </p>
        <Button type="button" variant={blockContacts ? "secondary" : "primary"} size="md" className="h-11.5 text-body font-medium" onClick={() => setBlockContacts((v) => !v)} aria-pressed={blockContacts}>
          {blockContacts ? "Contact blocking on ✓" : "Turn on contact blocking"}
        </Button>
      </OceanCard>

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
