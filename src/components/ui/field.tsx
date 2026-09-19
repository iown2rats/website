import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { ChevronDownIcon } from "./icons";

/*
 * Fields. The prototype's 52 px control is now 44 (docs/DESIGN_SYSTEM.md §32) with 15 px text instead of 16–18 and
 * no bold anywhere: an input's value is content, not a heading. Radius and the surface-muted fill are unchanged, so
 * the identity is the same shape at a smaller scale.
 */

const fieldBase =
  "w-full bg-surface-muted text-text border-0 rounded-lg outline-none placeholder:text-text-muted " +
  "focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-55 aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-danger";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Larger 16 px entry for phone and name, still weight 400. */
  emphasis?: boolean;
  leading?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, emphasis, leading, ...rest }, ref) {
  if (leading) {
    return (
      <div className={cn("flex items-center gap-2 h-11 px-3.5 bg-surface-muted rounded-lg focus-within:outline-2 focus-within:outline-primary", className)}>
        <span className="text-text-secondary shrink-0 inline-flex">{leading}</span>
        <input ref={ref} className={cn("h-full flex-1 min-w-0 bg-transparent border-0 outline-none text-body-lg text-text placeholder:text-text-muted")} {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cn(fieldBase, "h-11 px-3.5", emphasis ? "text-input-lg tracking-[.03em]" : "text-body-lg", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(fieldBase, "rounded-lg px-3.5 py-2.5 text-body-lg leading-normal resize-none", className)} {...rest} />;
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
        className={cn(fieldBase, "h-11 pl-3 pr-7 text-body-lg appearance-none cursor-pointer", empty && "text-text-secondary")}
        {...rest}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {children}
      </select>
      <ChevronDownIcon size={15} strokeWidth={2} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={id} className={cn("text-body-sm font-medium text-text", hideLabel && "sr-only")}>
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
        <p id={errorId} role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
