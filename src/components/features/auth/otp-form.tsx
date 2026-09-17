"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { resendOtp, submitOtp, type OtpFormState } from "@/actions/auth";
import { cn } from "@/lib/cn";
import { FormError, SubmitButton } from "@/components/features/onboarding/submit-button";
import { ROUTES } from "@/server/auth/route-access";

/*
 * Prototype step 2: six 52 px boxes (radius 14, 1.5 px border, active box primary) and "Code sent to +960 …
 * Resend". Implemented as ONE real input (numeric keyboard, one-time-code autofill, paste, backspace) laid over
 * the six boxes, which mirror its value. Auto-submits at 6 digits. The prototype's on-screen keypad is
 * intentionally replaced by the device keyboard (documented in docs/DESIGN_SYSTEM.md).
 */
export interface OtpFormProps {
  phoneLocal: string;
  resendAvailableAt: number;
  devCode?: string;
  /** True when the challenge in the cookie has already expired on arrival (e.g. the tab was left open). */
  initialExpired?: boolean;
  length?: number;
}

function useCountdown(target: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [target]);
  return Math.max(0, Math.ceil((target - now) / 1000));
}

export function OtpForm({ phoneLocal, resendAvailableAt: initialResendAt, devCode: initialDevCode, initialExpired = false, length = 6 }: OtpFormProps) {
  const [state, action] = useActionState<OtpFormState, FormData>(
    submitOtp,
    initialExpired ? { error: "Your code has expired. Request a new one.", needsNewCode: true } : {},
  );
  const [code, setCode] = useState("");
  const [resendAt, setResendAt] = useState(initialResendAt);
  const [devCode, setDevCode] = useState(initialDevCode);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resending, startResend] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedFor = useRef<string | null>(null);
  const secondsLeft = useCountdown(resendAt);

  // Auto-submit once when 6 digits are present (typed, pasted or autofilled).
  useEffect(() => {
    if (code.length === length && submittedFor.current !== code) {
      submittedFor.current = code;
      formRef.current?.requestSubmit();
    }
  }, [code, length]);

  // After a wrong code, clear so the next attempt starts fresh. Compared by state identity, not message text:
  // the same wrong code twice yields the same message and must still clear the boxes.
  const lastErrorState = useRef<OtpFormState | null>(null);
  useEffect(() => {
    if (state.error && state !== lastErrorState.current) {
      lastErrorState.current = state;
      setCode("");
      submittedFor.current = null;
      inputRef.current?.focus();
    }
  }, [state]);

  const onResend = () => {
    setResendMessage(null);
    startResend(async () => {
      const result = await resendOtp();
      if (result.resendAvailableAt) setResendAt(result.resendAvailableAt);
      if (result.devCode) setDevCode(result.devCode);
      setResendMessage(result.error ?? "We sent you a new code.");
      setCode("");
      submittedFor.current = null;
      inputRef.current?.focus();
    });
  };

  const boxes = Array.from({ length }, (_, i) => code[i] ?? "");
  const activeIndex = Math.min(code.length, length - 1);

  return (
    <form ref={formRef} action={action} className="flex flex-1 flex-col gap-3.5" noValidate>
      <div className="relative">
        <div className="grid grid-cols-6 gap-2" aria-hidden="true">
          {boxes.map((d, i) => (
            <div
              key={i}
              className={cn(
                "grid h-13 place-items-center rounded-md border-[1.5px] bg-surface text-h4 tabular-nums",
                i === activeIndex && !state.needsNewCode ? "border-primary" : "border-border",
              )}
            >
              {d}
            </div>
          ))}
        </div>
        <label htmlFor="code" className="sr-only">
          6-digit code sent by SMS
        </label>
        <input
          ref={inputRef}
          id="code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, length))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          autoFocus
          disabled={Boolean(state.needsNewCode)}
          aria-invalid={state.error ? true : undefined}
          aria-describedby="code-note"
          className="absolute inset-0 size-full cursor-text opacity-0"
        />
      </div>
      <p id="code-note" className="text-caption text-text-secondary">
        Code sent to +960 {phoneLocal}.{" "}
        {state.needsNewCode ? null : secondsLeft > 0 ? (
          <span>Resend in {secondsLeft}s</span>
        ) : (
          <button type="button" onClick={onResend} disabled={resending} className="border-0 bg-transparent p-0 font-semibold text-primary-pressed disabled:opacity-50">
            {resending ? "Sending…" : "Resend"}
          </button>
        )}
      </p>
      {devCode ? (
        <p className="rounded-xl bg-aqua-soft px-4 py-3 text-caption text-on-aqua-soft">
          Development only: your code is <b className="tabular-nums tracking-[.08em]">{devCode}</b>
        </p>
      ) : null}
      <FormError message={state.error} />
      {resendMessage && !state.error ? <p className="text-caption text-text-secondary">{resendMessage}</p> : null}
      {state.attemptsRemaining != null && state.attemptsRemaining > 0 && state.attemptsRemaining <= 2 ? (
        <p className="text-caption text-text-secondary">{state.attemptsRemaining} attempts left.</p>
      ) : null}
      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        {state.needsNewCode ? (
          <Link href={ROUTES.phone} className="flex h-13 items-center justify-center rounded-lg bg-primary text-body-lg font-bold text-on-primary pressable">
            Request a new code
          </Link>
        ) : (
          <SubmitButton disabled={code.length < length}>Continue</SubmitButton>
        )}
        <Link href={ROUTES.phone} className="flex h-11 items-center justify-center text-body-sm font-semibold text-text-secondary">
          Use a different number
        </Link>
      </div>
    </form>
  );
}
