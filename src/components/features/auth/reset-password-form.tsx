"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { resetPasswordAction } from "@/actions/email-auth";
import { PASSWORD_RULES } from "@/server/auth/password";
import { ROUTES } from "@/server/auth/route-access";
import { GlassPasswordField, GlassSubmit } from "./glass-field";

/** Choose a new password from a reset link. On success every session is already gone, so the next step is signing in. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<{ message: string; field?: "password" | "confirmPassword" } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();

  if (done) {
    return (
      <div className="mt-4 flex w-full flex-col gap-3">
        <p className="text-body-sm leading-relaxed text-white/85">Your password is changed and every device has been signed out. Sign in with the new password.</p>
        <Link href={ROUTES.welcome} className="pressable flex h-11 w-full items-center justify-center rounded-full bg-primary text-cta-lg font-medium text-on-primary shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <form
      className="mt-4 flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await resetPasswordAction({
            token,
            password: String(data.get("password") ?? ""),
            confirmPassword: String(data.get("confirmPassword") ?? ""),
          });
          if (r.ok) setDone(true);
          else setError({ message: r.message ?? "Check the details and try again.", field: r.field === "email" ? undefined : r.field });
        });
      }}
    >
      <GlassPasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        placeholder="New password"
        required
        minLength={PASSWORD_RULES.minLength}
        disabled={busy}
        error={error?.field === "password" ? error.message : undefined}
      />
      <GlassPasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="Confirm new password"
        required
        disabled={busy}
        error={error?.field === "confirmPassword" ? error.message : undefined}
      />
      <p className="px-4 text-left text-caption-sm text-white/70">At least {PASSWORD_RULES.minLength} characters.</p>
      {error && !error.field ? (
        <p role="alert" className="px-4 text-left text-caption-sm font-medium text-[#ffc9c9]">
          {error.message}
        </p>
      ) : null}
      <GlassSubmit loading={busy}>{busy ? "Saving…" : "Set new password"}</GlassSubmit>
    </form>
  );
}
