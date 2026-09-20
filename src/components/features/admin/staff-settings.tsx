"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { staffForgotPasswordAction, staffSignOutAction } from "@/actions/staff";

/**
 * Change password and sign out (docs/ARCHITECTURE.md §15). Changing a password goes through the same emailed,
 * single-use, expiring link as "forgot password" rather than an in-page form: it proves control of the address at
 * the moment of the change and needs no second credential path to maintain.
 */
export function StaffSettingsActions({ email }: { email: string | null }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function sendReset() {
    if (!email) return;
    startTransition(async () => {
      const result = await staffForgotPasswordAction({ email }).catch(() => null);
      if (result?.ok) setSent(true);
      else toast.show("That didn't go through. Try again.");
    });
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      {sent ? <Callout tone="ocean" title="Check your inbox">A link to choose a new password is on its way. It works once and expires in an hour.</Callout> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={sendReset} disabled={pending || !email || sent}>
          Change password
        </Button>
        <form action={staffSignOutAction}>
          <Button size="sm" variant="muted" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
