"use client";

import { useId, useState } from "react";
import { confirmAccountDeletion, requestAccountDeletionCode } from "@/actions/account";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle, ResponsiveDialog } from "@/components/ui/dialog";

/*
 * Delete account (prototype Settings → Account management → "Delete Account", red; "requires confirmation by
 * SMS"). Two explicit steps: what deletion does, then a fresh code sent to the account's own phone. The server
 * verifies the code and anonymises the account; the session ends and the app returns to the welcome screen.
 */
export function DeleteAccountSheet({ open, onClose, maskedPhone }: { open: boolean; onClose: () => void; maskedPhone: string }) {
  const titleId = useId();
  const [step, setStep] = useState<"confirm" | "code">("confirm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [canResend, setCanResend] = useState(true);
  const [code, setCode] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setStep("confirm"); setError(null); setCode(""); setChallengeId(null); setDevCode(null); }
  }

  const holdResend = (until: number) => {
    setCanResend(false);
    window.setTimeout(() => setCanResend(true), Math.max(0, until - Date.now()));
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const r = await requestAccountDeletionCode().catch(() => null);
    setBusy(false);
    if (!r) { setError("Thundi couldn't reach the server. Try again."); return; }
    if (!r.ok) { setError(r.message); if (r.retryAt) holdResend(r.retryAt); if (r.code === "COOLDOWN" && challengeId) setStep("code"); return; }
    setChallengeId(r.challengeId);
    setDevCode(r.devCode ?? null);
    holdResend(r.resendAvailableAt);
    setStep("code");
  };

  const confirm = async () => {
    if (!challengeId) { setError("Request a code first."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await confirmAccountDeletion({ challengeId, code });
      // On success the action clears the session and redirects; a result only arrives on failure.
      if (r && !r.ok) { setError(r.message); setBusy(false); }
    } catch {
      // A redirect thrown by the server action is handled by Next; anything else is a transport failure.
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={busy ? () => undefined : onClose} labelledBy={titleId} dismissible={!busy}>
      {step === "confirm" ? (
        <>
          <DialogTitle id={titleId} className="text-[22px]">Delete your account?</DialogTitle>
          <DialogDescription>This can&apos;t be undone.</DialogDescription>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-body-sm leading-relaxed text-text-secondary">
            <li>Your profile, photos, likes and Community posts are removed.</li>
            <li>Your matches end and your chats close for the other person.</li>
            <li>Safety records (reports and blocks) are kept so they stay effective.</li>
            <li>Your number becomes free to register again.</li>
          </ul>
          <p className="text-body-sm text-text-secondary">To confirm, we&apos;ll text a code to <span className="font-semibold text-text">{maskedPhone}</span>.</p>
          {error ? <p role="alert" className="text-caption font-semibold text-danger">{error}</p> : null}
          <div className="flex flex-col gap-2.5 pt-1">
            <Button variant="destructive" onClick={() => void sendCode()} loading={busy} fullWidth>Send code</Button>
            <Button variant="muted" size="md" onClick={onClose} disabled={busy} fullWidth>Cancel</Button>
          </div>
        </>
      ) : (
        <>
          <DialogTitle id={titleId} className="text-[22px]">Enter the code</DialogTitle>
          <DialogDescription>We sent a 6-digit code to {maskedPhone}. Entering it deletes your account.</DialogDescription>
          {devCode ? <p className="rounded-lg bg-aqua-soft px-3.5 py-2.5 text-caption text-on-aqua-soft">Development code: <b className="tabular-nums">{devCode}</b></p> : null}
          <label htmlFor={`${titleId}-code`} className="sr-only">6-digit code</label>
          <input
            id={`${titleId}-code`}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="••••••"
            aria-invalid={error ? true : undefined}
            className="h-14 w-full rounded-lg border border-border bg-surface px-4 text-center text-[24px] font-bold tracking-[.3em] text-text outline-none placeholder:text-text-muted focus:border-primary aria-[invalid=true]:border-danger"
          />
          {error ? <p role="alert" className="text-caption font-semibold text-danger">{error}</p> : null}
          <div className="flex flex-col gap-2.5 pt-1">
            <Button variant="destructive" onClick={() => void confirm()} loading={busy} disabled={code.length !== 6} fullWidth>Delete my account</Button>
            <Button variant="muted" size="md" onClick={() => void sendCode()} disabled={busy || !canResend} fullWidth>{canResend ? "Resend code" : "Resend available shortly"}</Button>
            <Button variant="ghost" size="md" onClick={onClose} disabled={busy} fullWidth>Keep my account</Button>
          </div>
        </>
      )}
    </ResponsiveDialog>
  );
}
