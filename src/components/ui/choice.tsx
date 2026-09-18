"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "./icons";

/*
 * Choice controls from the prototype:
 *  - RadioCard: 52–58 px surface card, 1.5 px border, label left, 20–22 px dot right; selected = primary border,
 *    aqua-soft background, filled dot.
 *  - Switch: 52 × 32 pill, 26 px white knob with 3 px inset; on = primary, off = border colour. Compact 44 × 26.
 *  - Checkbox: 22 px rounded square, same colour logic (new; the prototype uses cards and switches only).
 */

export interface RadioCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  selected: boolean;
  label: ReactNode;
  description?: ReactNode;
  onSelect: () => void;
}

export const RadioCard = forwardRef<HTMLButtonElement, RadioCardProps>(function RadioCard(
  { selected, label, description, onSelect, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "w-full min-h-13 px-4.5 py-2.5 rounded-lg text-left flex items-center justify-between gap-3 text-text",
        selected ? "bg-primary-soft" : "bg-surface-muted",
        className,
      )}
      {...rest}
    >
      <span className="min-w-0">
        <span className="block text-body font-semibold">{label}</span>
        {description ? <span className="block text-caption-sm text-text-secondary">{description}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className={cn("size-5.5 shrink-0 rounded-full border-2", selected ? "border-primary bg-primary" : "border-text-secondary/40 bg-transparent")}
      />
    </button>
  );
});

/** Accessible group wrapper for RadioCards. */
export function RadioGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-col gap-2.5", className)}>
      {children}
    </div>
  );
}

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  compact?: boolean;
  "aria-label"?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, compact = false, className, disabled, ...rest },
  ref,
) {
  const w = compact ? 44 : 52;
  const h = compact ? 26 : 32;
  const knob = compact ? 20 : 26;
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("relative shrink-0 rounded-full border-0 transition-colors duration-200 disabled:opacity-45", checked ? "bg-accent" : "bg-border", className)}
      style={{ width: w, height: h }}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn("absolute top-[3px] rounded-full shadow-knob transition-[left,background-color] duration-200", checked ? "bg-white" : "bg-text")}
        style={{ width: knob, height: knob, left: checked ? w - knob - 3 : 3 }}
      />
    </button>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, id, ...rest }, ref) {
  return (
    <label className={cn("inline-flex items-center gap-3 cursor-pointer select-none text-body text-text", className)}>
      <span className="relative inline-grid place-items-center size-5.5">
        <input ref={ref} id={id} type="checkbox" className="peer absolute inset-0 opacity-0 m-0 cursor-pointer" {...rest} />
        <span
          aria-hidden="true"
          className="size-5.5 rounded-[7px] border-2 border-text-secondary/40 bg-transparent transition-colors peer-checked:bg-primary peer-checked:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-primary peer-focus-visible:outline-offset-2"
        />
        <CheckIcon size={14} strokeWidth={3} className="absolute text-on-primary opacity-0 peer-checked:opacity-100 pointer-events-none" />
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
});

/** Simple native radio for forms where cards are too heavy. */
export const Radio = forwardRef<HTMLInputElement, CheckboxProps>(function Radio({ label, className, ...rest }, ref) {
  return (
    <label className={cn("inline-flex items-center gap-3 cursor-pointer select-none text-body text-text", className)}>
      <span className="relative inline-grid place-items-center size-5.5">
        <input ref={ref} type="radio" className="peer absolute inset-0 opacity-0 m-0 cursor-pointer" {...rest} />
        <span aria-hidden="true" className="size-5.5 rounded-full border-2 border-text-secondary/40 bg-transparent transition-colors peer-checked:border-primary peer-focus-visible:outline-2 peer-focus-visible:outline-primary peer-focus-visible:outline-offset-2" />
        <span aria-hidden="true" className="absolute size-2.5 rounded-full bg-primary opacity-0 peer-checked:opacity-100" />
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
});

/** Selectable chip (interests, filters): 40 px pill, no outline; quiet warm tint, selected = solid coral with dark text. */
export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  size?: "sm" | "md";
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip({ selected = false, size = "md", className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center rounded-full font-semibold whitespace-nowrap",
        size === "md" ? "h-10 px-4 text-body-sm" : "h-9.5 px-4 text-body-sm",
        selected ? "bg-primary text-on-primary" : "bg-surface-muted text-text",
        className,
      )}
      {...rest}
    />
  );
});
