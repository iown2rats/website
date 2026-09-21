"use client";

import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/*
 * The auth screen's controls (DESIGN_SYSTEM §37). There is no card behind them any more; they sit on the cover
 * photograph, and depth is what tells them apart:
 *
 *   Email and Password are PRESSED IN   — `auth-recessed`, shadow inside the top edge, light inside the bottom
 *   the coral primary is RAISED         — `auth-raised`, a soft shadow beneath it
 *
 * That opposition is the whole design, so the two must never be given the same treatment. The provider buttons sit
 * between them at almost no depth (`auth-flat`, in google-button.tsx).
 *
 * The pill, the height and the focus ring are unchanged, and so is the type: `text-field` is 16px, and the
 * structural floor in globals.css keeps it there whatever anyone does to the scale later — below 16px iOS Safari
 * zooms on focus and never zooms back. The member app's own fields (warm surface, 16px radius) are untouched.
 */
export interface GlassFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label: string;
  error?: string;
}

// No border at all: an outline would flatten the inset shadow into a drawn rectangle, which is the thing that
// makes cheap neumorphism look like a sticker. Invalid state is a coral ring instead, drawn as a shadow so it
// stacks with the recess rather than replacing it.
const base =
  "auth-recessed h-12 w-full rounded-full border-0 px-4.5 text-field text-white placeholder:text-white/60 " +
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/85 " +
  "aria-[invalid=true]:shadow-[inset_0_2px_4px_rgba(0,0,0,0.55),inset_0_-1px_0_rgba(255,255,255,0.16),0_0_0_1.5px_#ff9a9a] disabled:opacity-60";

export function GlassField({ label, error, id: providedId, ...rest }: GlassFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex w-full flex-col gap-1.5 text-left">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input id={id} aria-describedby={errorId} aria-invalid={error ? true : undefined} className={base} {...rest} />
      {error ? (
        <p id={errorId} role="alert" className="px-4 text-caption-sm font-medium text-[#ffc9c9]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Password field with a show/hide toggle. The toggle is a real button and says what it does. */
export function GlassPasswordField({ label, error, id: providedId, ...rest }: GlassFieldProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = error ? `${id}-error` : undefined;
  const [shown, setShown] = useState(false);
  return (
    <div className="flex w-full flex-col gap-1.5 text-left">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <input id={id} type={shown ? "text" : "password"} aria-describedby={errorId} aria-invalid={error ? true : undefined} className={cn(base, "pr-13")} {...rest} />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-white/85"
        >
          {shown ? <EyeOffIcon size={18} title="Hide password" /> : <EyeIcon size={18} title="Show password" />}
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="px-4 text-caption-sm font-medium text-[#ffc9c9]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The primary action: the MelloCrush coral, sitting slightly PROUD of the surface. Its soft outer shadow is the
 * mirror image of the fields' inner one — the fields go in, this comes out — which is what makes the screen read
 * as a surface with things pressed into and resting on it rather than a stack of translucent rectangles.
 */
export function GlassSubmit({ children, loading = false, ...rest }: { children: ReactNode; loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button
      type="submit"
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      className="auth-raised pressable flex h-12 w-full items-center justify-center rounded-full text-cta-lg font-medium text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/85 disabled:opacity-60"
      {...rest}
    >
      {children}
    </button>
  );
}
