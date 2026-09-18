"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { signInWithEmailAction } from "@/actions/email-auth";
import { ROUTES } from "@/server/auth/route-access";
import { GlassField, GlassPasswordField, GlassSubmit } from "./glass-field";

/**
 * The email half of the welcome card (DESIGN_SYSTEM §27): address, password, Continue, then "Create account" and
 * "Forgot password?". A successful sign-in redirects from the server action, so there is no success state here.
 */
export function EmailSignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <form
      className="mt-5 flex w-full flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await signInWithEmailAction({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
          if (r && !r.ok) setError(r.message ?? "That email and password don't match an account.");
        });
      }}
    >
      <GlassField label="Email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="Email" required disabled={busy} />
      <GlassPasswordField label="Password" name="password" autoComplete="current-password" placeholder="Password" required disabled={busy} />
      {error ? (
        <p role="alert" className="px-4 text-left text-[13px] font-semibold text-[#ffc9c9]">
          {error}
        </p>
      ) : null}
      <GlassSubmit loading={busy}>{busy ? "Signing in…" : "Continue"}</GlassSubmit>
      <div className="mt-1 flex items-center justify-between text-[14px]">
        <Link href={ROUTES.register} className="font-semibold text-white underline decoration-white/50 underline-offset-[3px]">
          Create account
        </Link>
        <Link href={ROUTES.forgotPassword} className="font-medium text-white/85 underline decoration-white/40 underline-offset-[3px]">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
