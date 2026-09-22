"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { createSubmitLock, type SubmitLock } from "@/lib/submit-lock";
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

type PortalResult = { ok: true } | { ok: false; message: string; field?: string; retryAfterSeconds?: number };

/**
 * One click, one request — and after a refusal, still one request.
 *
 * `busy` alone is not enough to stop a double submit. It is React state, so two submit events dispatched in the
 * same tick both read the old `false` and both fire. The ref is the actual lock, taken and released synchronously;
 * `busy` exists to drive the spinner and the disabled attributes, which is a rendering concern, not a guard.
 *
 * `cooldown` is the 429 handler. When the server says how long its window has left, the form counts down and the
 * submit button stays disabled until it reaches zero. Nothing retries on its own, here or anywhere else in this
 * file: a rate-limited form that keeps trying is how a rate limit becomes a permanent one.
 */
function useSubmitGuard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // The real guard, from src/lib/submit-lock.ts. The state above only renders what it decides.
  const lockRef = useRef<SubmitLock | null>(null);
  const lock = (lockRef.current ??= createSubmitLock());

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(lock.remaining()), 1000);
    return () => clearTimeout(timer);
  }, [cooldown, lock]);

  async function submit(work: () => Promise<PortalResult | null>): Promise<PortalResult | null> {
    setError(null);
    const attempt = await lock.run(async () => {
      setBusy(true);
      try {
        return await work();
      } finally {
        setBusy(false);
      }
    });
    if (!attempt.ran) return null; // A second click, or a cooldown. No request was made and none will be.

    const result = attempt.value;
    if (result === null) {
      // The action neither resolved nor refused: the network dropped it. Say so — silence is what made somebody
      // click twenty times (docs/ARCHITECTURE.md §22.10).
      setError({ message: "We couldn't reach Mellocrush. Check your connection and try again." });
      return null;
    }
    if (!result.ok) {
      setError({ message: result.message, field: result.field });
      if (result.retryAfterSeconds) {
        lock.cool(result.retryAfterSeconds);
        setCooldown(lock.remaining());
      }
    }
    return result;
  }

  return { busy, error, setError, cooldown, submit, locked: busy || cooldown > 0 };
}

/** The cooldown line shown under a rate-limited form. Purely informational; nothing acts on it. */
function Cooldown({ seconds }: { seconds: number }) {
  if (seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const label = minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds % 60}s` : `${seconds}s`;
  return (
    <p className="text-center text-body-sm text-text-secondary" role="status">
      You can try again in {label}.
    </p>
  );
}

export function StaffSignInForm() {
  const { busy, error, cooldown, submit, locked } = useSubmitGuard();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    // A successful sign-in redirects, so anything that comes back here is a refusal.
    await submit(() => staffSignInAction({ email, password }).catch(() => null));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? <Callout tone="danger">{error.message}</Callout> : null}
      <Field label="Email">
        {(props) => <Input {...props} name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={locked} />}
      </Field>
      <Field label="Password">
        {(props) => <Input {...props} name="password" type="password" autoComplete="current-password" required disabled={locked} />}
      </Field>
      <Button type="submit" fullWidth loading={busy} disabled={locked}>
        Sign in
      </Button>
      <Cooldown seconds={cooldown} />
      <Link href="/admin/forgot-password" className="text-center text-body-sm text-text-secondary hover:text-text">
        Forgot password?
      </Link>
    </form>
  );
}

export function StaffForgotPasswordForm() {
  const { busy, error, cooldown, submit, locked } = useSubmitGuard();
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    const result = await submit(() => staffForgotPasswordAction({ email }).catch(() => null));
    if (result?.ok) setSent(true);
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
        {(props) => <Input {...props} name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={locked} />}
      </Field>
      <Button type="submit" fullWidth loading={busy} disabled={locked}>
        Send reset link
      </Button>
      <Cooldown seconds={cooldown} />
      <Link href="/admin/login" className="text-center text-body-sm text-text-secondary hover:text-text">
        Back to sign in
      </Link>
    </form>
  );
}

/** Used by both the invitation claim and the "set your first password" link; `mode` only changes the wording. */
export function StaffSetPasswordForm({ token, mode }: { token: string; mode: "claim" | "reset" }) {
  const { busy, error, setError, cooldown, submit, locked } = useSubmitGuard();
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError({ message: "Those passwords don't match.", field: "confirmPassword" });
      return;
    }
    // Claiming redirects into the portal on success, so only the reset variant ever sees `ok` here.
    const result = await submit(() =>
      mode === "claim" ? staffSetPasswordAction({ token, password }).catch(() => null) : staffResetPasswordAction({ token, password }).catch(() => null),
    );
    if (result?.ok) setDone(true);
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
        {(props) => <Input {...props} name="password" type="password" autoComplete="new-password" required disabled={locked} />}
      </Field>
      <Field label="Confirm password" error={error?.field === "confirmPassword" ? error.message : undefined}>
        {(props) => <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" required disabled={locked} />}
      </Field>
      <Button type="submit" fullWidth loading={busy} disabled={locked}>
        {mode === "claim" ? "Set password and sign in" : "Save password"}
      </Button>
      <Cooldown seconds={cooldown} />
    </form>
  );
}
