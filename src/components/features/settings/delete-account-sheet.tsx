"use client";

import { useId, useState } from "react";
import { confirmAccountDeletion } from "@/actions/account";
import { ContinueWith } from "@/components/features/auth/google-button";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";

/*
 * Delete account (prototype Settings → Account management → "Delete Account", red). Two explicit steps
 * (docs/ARCHITECTURE.md §4.4): what deletion does, then a fresh sign-in with the same Google or Telegram account. The
 * re-authentication marks this session for five minutes; the final "Delete my account" consumes that mark on the
 * server, so an old application session alone can never delete an account.
 */
export interface RecentAuthDto {
  fresh: boolean;
  /** Epoch ms when the current confirmation stops counting, if any. */
  expiresAt: number | null;
}

export interface SignInSummary {
  provider: "google" | "telegram";
  /** Email (Google) or @username / name (Telegram); null when unknown. */
  account: string | null;
}

const PROVIDER_NAME = { google: "Google", telegram: "Telegram" } as const;

export function DeleteAccountSheet({ open, onClose, signIn, recentAuth }: { open: boolean; onClose: () => void; signIn: SignInSummary | null; recentAuth: RecentAuthDto }) {
  const titleId = useId();
  const provider = signIn?.provider ?? "google";
  const P = PROVIDER_NAME[provider];
  const account = signIn?.account ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const fresh = recentAuth.fresh && !expired;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await confirmAccountDeletion();
      // On success the action clears the session and redirects; a result only arrives on failure.
      if (r && !r.ok) {
        if (r.code === "REAUTH_REQUIRED") setExpired(true);
        setError(r.message);
        setBusy(false);
      }
    } catch {
      // A redirect thrown by the server action is handled by Next; anything else is a transport failure.
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={busy ? () => undefined : onClose} labelledBy={titleId} dismissible={!busy}>
      {!fresh ? (
        <>
          <DialogTitle id={titleId} className="text-[22px]">Delete your account?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-body-sm leading-relaxed text-text-secondary">
            <li>Your profile, photos, likes and Community posts are removed.</li>
            <li>Your matches end and your chats close for the other person.</li>
            <li>Safety records (reports and blocks) are kept so they stay effective.</li>
            <li>Signing in with the same {P} account later starts a brand-new account; nothing comes back.</li>
          </ul>
          <p className="text-body-sm text-text-secondary">
            To confirm, sign in with {P} again{account ? <> as <span className="font-semibold text-text">{account}</span></> : null}.
          </p>
          {error ? <p role="alert" className="text-caption font-semibold text-danger">{error}</p> : null}
          <div className="flex flex-col gap-2.5 pt-1">
            <ContinueWith provider={provider} purpose="reauth" returnTo="/settings?confirmDelete=1" label={`Continue with ${P} to confirm`} className="shadow-sm" />
            <Button variant="muted" size="md" onClick={onClose} disabled={busy} fullWidth>Cancel</Button>
          </div>
        </>
      ) : (
        <>
          <DialogTitle id={titleId} className="text-[22px]">Confirm deletion</DialogTitle>
          <DialogDescription>You just confirmed with {P}{account ? ` as ${account}` : ""}. This is the last step and can&apos;t be undone.</DialogDescription>
          {error ? <p role="alert" className="text-caption font-semibold text-danger">{error}</p> : null}
          <div className="flex flex-col gap-2.5 pt-1">
            <Button variant="destructive" onClick={() => void confirm()} loading={busy} fullWidth>Delete my account</Button>
            <Button variant="ghost" size="md" onClick={onClose} disabled={busy} fullWidth>Keep my account</Button>
          </div>
        </>
      )}
    </ResponsiveDialog>
  );
}
