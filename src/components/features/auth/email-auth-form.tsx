"use client";

import Link from "next/link";
import { useReducer, useTransition } from "react";
import { registerWithEmailAction, signInWithEmailAction } from "@/actions/email-auth";
import { PASSWORD_RULES } from "@/server/auth/password";
import { ROUTES } from "@/server/auth/route-access";
import { authCardReducer, initialAuthCardState, MODE_COPY, type AuthCardMode } from "./auth-card-state";
import { GlassField, GlassPasswordField, GlassSubmit } from "./glass-field";

/**
 * The email half of the auth screen (DESIGN_SYSTEM §37). One form, two modes: signing in, and creating an account.
 * Switching is local state — the same screen, the same provider buttons above it, no navigation — so the person
 * never loses their place, and Sign Up therefore inherits the recessed fields rather than restyling them. Both
 * modes end at the same server actions, which own every rule that matters: a new account is redirected to "Verify
 * your email" and can use nothing until the address is confirmed.
 */
export function EmailAuthForm({ initialMode = "signin" }: { initialMode?: AuthCardMode }) {
  const [state, dispatch] = useReducer(authCardReducer, initialMode, initialAuthCardState);
  const [busy, start] = useTransition();
  const copy = MODE_COPY[state.mode];
  const pending = busy || state.busy;

  if (state.sentTo) {
    return (
      <div className="auth-legible mt-5 flex w-full flex-col gap-2 text-body-sm leading-relaxed text-white/90">
        <p>
          If <span className="font-medium text-white">{state.sentTo}</span> can be used, a confirmation link is on its way. Open it to finish setting up your account.
        </p>
        <p className="text-caption-sm text-white/80">The link works once and expires in 24 hours. Check your spam folder if it hasn&apos;t arrived in a few minutes.</p>
        <button type="button" onClick={() => dispatch({ type: "switchMode", mode: "signin" })} className="h-10 text-caption-sm font-medium text-primary underline decoration-primary/50 underline-offset-[3px]">
          Back to sign in
        </button>
      </div>
    );
  }

  const fieldError = (field: string) => (state.error?.field === field ? state.error.message : undefined);

  return (
    <form
      className="mt-4 flex w-full flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const email = String(data.get("email") ?? "");
        const password = String(data.get("password") ?? "");
        const confirmPassword = String(data.get("confirmPassword") ?? "");
        dispatch({ type: "submit" });
        start(async () => {
          if (state.mode === "register") {
            const r = await registerWithEmailAction({ email, password, confirmPassword });
            // A brand-new account never returns: the action redirects to the verification screen.
            if (!r) return;
            if (r.ok) dispatch({ type: "registered", email: r.email ?? email });
            else dispatch({ type: "failed", message: r.message ?? "Check the details and try again.", field: r.field });
          } else {
            const r = await signInWithEmailAction({ email, password });
            if (r && !r.ok) dispatch({ type: "failed", message: r.message ?? "That email and password don't match an account.", field: r.field });
          }
        });
      }}
    >
      <GlassField label="Email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="Email" required disabled={pending} error={fieldError("email")} />
      <GlassPasswordField
        label={state.mode === "register" ? "Create password" : "Password"}
        name="password"
        autoComplete={state.mode === "register" ? "new-password" : "current-password"}
        placeholder={state.mode === "register" ? "Create password" : "Password"}
        required
        minLength={state.mode === "register" ? PASSWORD_RULES.minLength : undefined}
        disabled={pending}
        error={fieldError("password")}
      />
      {state.mode === "register" ? (
        <>
          <GlassPasswordField
            label="Confirm password"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="Confirm password"
            required
            disabled={pending}
            error={fieldError("confirmPassword")}
          />
          <p className="auth-legible px-4 text-left text-caption-sm text-white/80">At least {PASSWORD_RULES.minLength} characters. Length beats punctuation.</p>
        </>
      ) : null}
      {state.error && !state.error.field ? (
        <p role="alert" className="auth-legible px-4 text-left text-caption-sm font-medium text-[#ffc9c9]">
          {state.error.message}
        </p>
      ) : null}

      <GlassSubmit loading={pending}>{pending ? copy.busy : copy.submit}</GlassSubmit>

      {state.mode === "signin" ? (
        <Link href={ROUTES.forgotPassword} className="auth-legible mt-1 h-8 text-caption-sm font-medium text-white/85 underline decoration-white/45 underline-offset-[3px]">
          Forgot password?
        </Link>
      ) : null}
      <p className="auth-legible mt-0.5 text-caption-sm text-white/85">
        {copy.prompt}{" "}
        <button type="button" onClick={() => dispatch({ type: "switchMode", mode: copy.to })} disabled={pending} className="font-medium text-primary underline decoration-primary/50 underline-offset-[3px]">
          {copy.action}
        </button>
      </p>
    </form>
  );
}
