"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { staffForgotPasswordAction, staffResetPasswordAction, staffSetPasswordAction, staffSignInAction } from "@/actions/staff";

/*
 * The portal's four forms. Each one posts to a server action and shows whatever that action returns; none of them
 * decides anything itself, and none of them is told more than the visitor is (docs/ARCHITECTURE.md §22.2).
 *
 * On success the sign-in and set-password actions redirect, so these components never see a success state for
 * those — a returned value always means a refusal.
 */

interface FormError {
  message: string;
  field?: string;
}

function useFormState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  return { busy, setBusy, error, setError };
}

export function StaffSignInForm() {
  const { busy, setBusy, error, setError } = useFormState();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await staffSignInAction({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") }).catch(() => null);
    // A successful sign-in redirects, so anything returned here is a refusal.
    if (result && !result.ok) setError({ message: result.message, field: result.field });
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Callout tone="danger">{error.message}</Callout> : null}
      <Field label="Email">
        {(props) => <Input {...props} name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy} />}
      </Field>
      <Field label="Password">
        {(props) => <Input {...props} name="password" type="password" autoComplete="current-password" required disabled={busy} />}
      </Field>
      <Button type="submit" fullWidth loading={busy}>
        Sign in
      </Button>
      <Link href="/admin/forgot-password" className="text-center text-body-sm text-text-secondary hover:text-text">
        Forgot password?
      </Link>
    </form>
  );
}

export function StaffForgotPasswordForm() {
  const { busy, setBusy, error, setError } = useFormState();
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await staffForgotPasswordAction({ email: String(form.get("email") ?? "") }).catch(() => null);
    if (result && !result.ok) setError({ message: result.message });
    else setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        {/* Deliberately identical whether or not that address is staff. */}
        <Callout tone="ocean" title="Check your inbox">
          If that address has an admin account, a reset link is on its way. The link works once and expires in an hour.
        </Callout>
        <Link href="/admin/login" className="text-center text-body-sm text-text-secondary hover:text-text">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Callout tone="danger">{error.message}</Callout> : null}
      <Field label="Email">
        {(props) => <Input {...props} name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy} />}
      </Field>
      <Button type="submit" fullWidth loading={busy}>
        Send reset link
      </Button>
      <Link href="/admin/login" className="text-center text-body-sm text-text-secondary hover:text-text">
        Back to sign in
      </Link>
    </form>
  );
}

/** Used by both the invitation claim and the "set your first password" link; `mode` only changes the wording. */
export function StaffSetPasswordForm({ token, mode }: { token: string; mode: "claim" | "reset" }) {
  const { busy, setBusy, error, setError } = useFormState();
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError({ message: "Those passwords don't match.", field: "confirmPassword" });
      return;
    }
    setBusy(true);
    setError(null);
    const result = mode === "claim" ? await staffSetPasswordAction({ token, password }).catch(() => null) : await staffResetPasswordAction({ token, password }).catch(() => null);
    if (result && !result.ok) setError({ message: result.message, field: result.field });
    else if (result?.ok) setDone(true);
    setBusy(false);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="ocean" title="Password saved">
          Every other session for this account has been signed out. Sign in with your new password.
        </Callout>
        <Link href="/admin/login" className="text-center text-body-sm text-text-secondary hover:text-text">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Callout tone="danger">{error.message}</Callout> : null}
      <Field label="New password" hint="At least 10 characters. Length matters more than symbols." error={error?.field === "password" ? error.message : undefined}>
        {(props) => <Input {...props} name="password" type="password" autoComplete="new-password" required disabled={busy} />}
      </Field>
      <Field label="Confirm password" error={error?.field === "confirmPassword" ? error.message : undefined}>
        {(props) => <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" required disabled={busy} />}
      </Field>
      <Button type="submit" fullWidth loading={busy}>
        {mode === "claim" ? "Set password and sign in" : "Save password"}
      </Button>
    </form>
  );
}
