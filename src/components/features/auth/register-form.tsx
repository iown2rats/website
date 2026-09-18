"use client";

import { useState, useTransition } from "react";
import { registerWithEmailAction } from "@/actions/email-auth";
import { PASSWORD_RULES } from "@/server/auth/password";
import { GlassField, GlassPasswordField, GlassSubmit } from "./glass-field";

type FieldName = "email" | "password" | "confirmPassword";

/**
 * Create an account with an email address. A brand-new account redirects to "Verify your email" from the server
 * action; an address that already has one gets the identical "check your inbox" screen, because telling the two
 * apart here would let anyone discover who has an account (§4.1b).
 */
export function RegisterForm() {
  const [error, setError] = useState<{ message: string; field?: FieldName } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (sentTo) {
    return (
      <div className="mt-4 flex w-full flex-col gap-2.5 text-[13px] leading-relaxed text-white/85">
        <p>
          If <span className="font-semibold text-white">{sentTo}</span> can be used, a confirmation link is on its way. Open it to finish setting up your account.
        </p>
        <p className="text-[12px] text-white/70">The link works once and expires in 24 hours. Check your spam folder if it hasn&apos;t arrived in a few minutes.</p>
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
          const r = await registerWithEmailAction({
            email: String(data.get("email") ?? ""),
            password: String(data.get("password") ?? ""),
            confirmPassword: String(data.get("confirmPassword") ?? ""),
          });
          if (!r) return;
          if (r.ok) setSentTo(r.email ?? String(data.get("email") ?? ""));
          else setError({ message: r.message ?? "Check the details and try again.", field: r.field });
        });
      }}
    >
      <GlassField label="Email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="Email" required disabled={busy} error={error?.field === "email" ? error.message : undefined} />
      <GlassPasswordField
        label="Create password"
        name="password"
        autoComplete="new-password"
        placeholder="Create password"
        required
        minLength={PASSWORD_RULES.minLength}
        disabled={busy}
        error={error?.field === "password" ? error.message : undefined}
      />
      <GlassPasswordField
        label="Confirm password"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="Confirm password"
        required
        disabled={busy}
        error={error?.field === "confirmPassword" ? error.message : undefined}
      />
      <p className="px-4 text-left text-[12px] text-white/70">At least {PASSWORD_RULES.minLength} characters. Length beats punctuation.</p>
      {error && !error.field ? (
        <p role="alert" className="px-4 text-left text-[12px] font-semibold text-[#ffc9c9]">
          {error.message}
        </p>
      ) : null}
      <GlassSubmit loading={busy}>{busy ? "Creating…" : "Create account"}</GlassSubmit>
    </form>
  );
}
