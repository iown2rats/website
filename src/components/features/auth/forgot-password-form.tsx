"use client";

import { useState, useTransition } from "react";
import { forgotPasswordAction } from "@/actions/email-auth";
import { GlassField, GlassSubmit } from "./glass-field";

/**
 * "Forgot password". The answer is the same whatever the address is — an account, no account, or rate-limited — so
 * this form can never be used to find out who has an account (§4.1b).
 */
export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();

  if (done) {
    return (
      <p className="mt-4 text-[13px] leading-relaxed text-white/85">
        If that address has a Mellocrush account with a password, a reset link is on its way. It works once and expires in an hour.
      </p>
    );
  }
  return (
    <form
      className="mt-4 flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => {
          await forgotPasswordAction({ email: String(data.get("email") ?? "") });
          setDone(true);
        });
      }}
    >
      <GlassField label="Email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="Email" required disabled={busy} />
      <GlassSubmit loading={busy}>{busy ? "Sending…" : "Send reset link"}</GlassSubmit>
    </form>
  );
}
