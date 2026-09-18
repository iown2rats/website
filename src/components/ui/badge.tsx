import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Tags and badges from the prototype:
 *  - CounterBadge: rose pill, plum text, 11 px/800, min 20 px (nav variant 16 px, 9.5 px).
 *  - PlusTag: Plus gold background, plum text, 8.5–12 px/800, letter-spacing .04em, radius 5–8 (the only gold in the UI).
 *  - Tag: teal-tint background, plum text, 11 px/800 uppercase (QUESTION), radius 8.
 */

export interface CounterBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  count: number;
  /** Compact variant used on bottom-nav icons. */
  compact?: boolean;
  max?: number;
}

export function CounterBadge({ count, compact = false, max = 99, className, ...rest }: CounterBadgeProps) {
  if (count <= 0) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span
      className={cn(
        "inline-grid place-items-center rounded-full bg-primary text-on-primary font-extrabold tabular-nums",
        compact ? "min-w-4 h-4 px-1 text-[9.5px]" : "min-w-5 h-5 px-1.5 text-[11px]",
        className,
      )}
      {...rest}
    >
      {text}
    </span>
  );
}

export type TagVariant = "aqua" | "plus" | "premium" | "neutral" | "success" | "warning" | "danger" | "onPhoto";

const tagVariant: Record<TagVariant, string> = {
  aqua: "bg-aqua-soft text-on-aqua-soft",
  plus: "bg-sand text-on-sand",
  premium: "bg-sand text-on-sand",
  neutral: "bg-surface-muted text-text-secondary",
  success: "bg-aqua-soft text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/10 text-danger",
  onPhoto: "bg-white text-text",
};

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant;
  size?: "xs" | "sm" | "md";
  children: ReactNode;
}

export function Tag({ variant = "aqua", size = "sm", className, children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center uppercase font-extrabold tracking-[.06em] whitespace-nowrap",
        size === "xs" && "h-4 px-1.25 text-[8.5px] rounded-[5px] tracking-[.04em]",
        size === "sm" && "h-5.5 px-2 text-[10px] rounded-[7px] tracking-[.04em]",
        size === "md" && "h-6 px-2.5 text-tag rounded-xs",
        tagVariant[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** "PLUS" marker used on premium controls (intro button corner, intro sheet, filter groups). */
export function PlusTag({ size = "sm", className, label = "Plus" }: { size?: "xs" | "sm" | "md"; className?: string; label?: string }) {
  return (
    <Tag variant="plus" size={size} className={className}>
      {label}
    </Tag>
  );
}

/** Larger label chip "MELLOCRUSH PLUS" on the Plus hero (26 px, gold background, plum text). */
export function PlusHeroTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center h-6.5 px-2.5 rounded-xs bg-sand text-on-sand text-micro font-extrabold tracking-[.04em] uppercase", className)}>
      Mellocrush Plus
    </span>
  );
}

/** Generic status badge (Verified / Pending / Free / Plus) for list-row meta. */
export function StatusBadge({ children, tone = "neutral", className }: { children: ReactNode; tone?: TagVariant; className?: string }) {
  return (
    <span className={cn("inline-flex items-center h-6 px-2.5 rounded-xs text-tag font-extrabold", tagVariant[tone], className)}>
      {children}
    </span>
  );
}
