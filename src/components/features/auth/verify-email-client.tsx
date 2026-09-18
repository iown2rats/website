"use client";

import { useState, useTransition } from "react";
import { changeUnverifiedEmailAction, resendVerificationAction, signOutAction } from "@/actions/email-auth";
import { GlassField, GlassSubmit } from "./glass-field";

/**
 * The only screen an unconfirmed email account can reach (docs/ARCHITECTURE.md §4.1b): it names the address, resends
 * the link, changes the address, or signs out. Everything else in Mellocrush is refused server-side until the
 * address is confirmed, so this screen is a door rather than a warning.
 */
export function VerifyEmailClient({ email, expired = false }: { email: string; expired?: boolean }) {
  const [notice, setNotice] = useState<string | null>(expired ? "That link has expired or was already used. Send yourself a new one." : null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, start] = useTransition();

  return (
    <div className="mt-5 flex w-full flex-col gap-3">
      <p className="text-[15px] leading-relaxed text-white/85">
        We sent a confirmation link to <span className="font-semibold text-white">{email}</span>. Open it to finish setting up your account.
      </p>
      {notice ? (
        <p role="status" className="rounded-2xl bg-white/12 px-4 py-3 text-[14px] leading-relaxed text-white">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-2xl bg-white/12 px-4 py-3 text-[14px] font-semibold leading-relaxed text-[#ffc9c9]">
          {error}
        </p>
      ) : null}

      {changing ? (
        <form
          className="flex w-full flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setError(null);
            setNotice(null);
            start(async () => {
              const r = await changeUnverifiedEmailAction({ email: String(data.get("email") ?? "") });
              if (r.ok) {
                setChanging(false);
                setNotice(r.message ?? "Sent.");
              } else setError(r.message ?? "Try another address.");
            });
          }}
        >
          <GlassField label="New email address" name="email" type="email" autoComplete="email" inputMode="email" placeholder="New email address" required disabled={busy} defaultValue={email} />
          <GlassSubmit loading={busy}>{busy ? "Saving…" : "Use this address"}</GlassSubmit>
          <button type="button" onClick={() => setChanging(false)} disabled={busy} className="h-11 text-[14px] font-medium text-white/85 underline decoration-white/40 underline-offset-[3px]">
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex w-full flex-col gap-2.5">
          <GlassSubmit
            loading={busy}
            onClick={() =>
              start(async () => {
                setError(null);
                setNotice(null);
                const r = await resendVerificationAction();
                if (r.ok) setNotice(r.message ?? "Sent.");
                else setError(r.message ?? "Try again shortly.");
              })
            }
          >
            {busy ? "Sending…" : "Resend verification email"}
          </GlassSubmit>
          <button type="button" onClick={() => setChanging(true)} disabled={busy} className="h-11 text-[14px] font-semibold text-white underline decoration-white/50 underline-offset-[3px]">
            Change email
          </button>
          <button type="button" onClick={() => void signOutAction()} disabled={busy} className="h-11 text-[14px] font-medium text-white/85 underline decoration-white/40 underline-offset-[3px]">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
