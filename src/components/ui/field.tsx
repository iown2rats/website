import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "./icons";

/*
 * Fields — prototype values: 52 px, radius 16, 1 px border, surface background, 16–18 px text,
 * padding 0 16px; textareas radius 18 padding 16px 18px; search field 48–56 px radius 16–18 in surface-muted.
 */

const fieldBase =
  "w-full bg-surface text-text border border-border rounded-lg outline-none placeholder:text-text-muted " +
  "focus:border-primary focus-visible:outline-none disabled:opacity-55 aria-[invalid=true]:border-danger";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Larger 18 px / 700 text for phone and name entry. */
  emphasis?: boolean;
  leading?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, emphasis, leading, ...rest }, ref) {
  if (leading) {
    return (
      <div className={cn("flex items-center gap-2.5 h-13 px-4 bg-surface border border-border rounded-lg focus-within:border-primary", className)}>
        <span className="text-text-secondary shrink-0 inline-flex">{leading}</span>
        <input ref={ref} className={cn("flex-1 min-w-0 bg-transparent border-0 outline-none text-body-lg text-text placeholder:text-text-muted")} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cn(fieldBase, "h-13 px-4", emphasis ? "text-input-lg tracking-[.04em]" : "text-body-lg", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(fieldBase, "rounded-xl px-4.5 py-4 text-body-lg leading-normal resize-none", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }>(function Select(
  { className, children, placeholder, value, defaultValue, ...rest },
  ref,
) {
  const empty = (value ?? defaultValue ?? "") === "";
  return (
    <span className={cn("relative block", className)}>
      <select
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        className={cn(fieldBase, "h-13 pl-3.5 pr-8 text-body-lg font-bold appearance-none cursor-pointer", empty && "text-text-secondary")}
        {...rest}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {children}
      </select>
      <ChevronDownIcon size={16} strokeWidth={2.2} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
    </span>
  );
});

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
  className?: string;
}

/** Wires label, hint and error to a control via ids. Render-prop keeps the control free of wrapper markup. */
export function Field({ label, hint, error, hideLabel, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <label htmlFor={id} className={cn("text-body-sm font-semibold text-text", hideLabel && "sr-only")}>
          {label}
        </label>
      ) : null}
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}) })}
      {hint && !error ? (
        <p id={hintId} className="text-caption text-text-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-caption font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
