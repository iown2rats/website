"use client";

import { useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/*
 * Inputs for the glass auth card (DESIGN_SYSTEM §27). They match the Google and Telegram buttons: the same width,
 * the same 52 px pill, white type on a translucent surface with a white hairline, and the same focus ring as the
 * rest of the app. The member app's own fields (warm surface, 16 px radius) are unchanged.
 */
export interface GlassFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label: string;
  error?: string;
}

const base =
  "h-11 w-full rounded-full border border-white/25 bg-white/10 px-3.5 text-body text-white placeholder:text-white/55 " +
  "outline-none focus-visible:border-white/60 focus-visible:outline-2 focus-visible:outline-white/80 " +
  "aria-[invalid=true]:border-[#ffb3b3] disabled:opacity-60";

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
          className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-white/75 hover:text-white focus-visible:outline-2 focus-visible:outline-white/80"
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

/** The card's primary action: a coral pill matching the height and radius of the provider buttons. */
export function GlassSubmit({ children, loading = false, ...rest }: { children: ReactNode; loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button
      type="submit"
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      className="pressable flex h-11 w-full items-center justify-center rounded-full bg-primary text-cta-lg font-medium text-on-primary shadow-[0_8px_24px_rgba(0,0,0,0.25)] disabled:opacity-60"
      {...rest}
    >
      {children}
    </button>
  );
}
