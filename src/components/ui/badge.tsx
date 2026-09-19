import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Tags and badges from the prototype:
 *  - CounterBadge: rose pill, plum text, 11 px/600, min 18 px (nav variant 14 px).
 *  - PlusTag: Plus gold background, plum text, 9–10.5 px/600, radius 5–8 (the only gold in the UI).
 *  - Tag: tinted background, plum text, 10.5 px/600 uppercase (QUESTION), radius 8.
 * Compact pass (§32): the chips lost a weight step and a size step; the gold and the rose are untouched.
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
        "inline-grid place-items-center rounded-full bg-primary text-on-primary font-medium tabular-nums",
        compact ? "min-w-3.5 h-3.5 px-1 text-tag" : "min-w-4.5 h-4.5 px-1.5 text-tiny",
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
        "inline-flex items-center uppercase font-medium tracking-[.04em] whitespace-nowrap",
        size === "xs" && "h-4 px-1.25 text-[9px] rounded-[5px] tracking-[.03em]",
        size === "sm" && "h-5 px-1.75 text-tag rounded-[6px]",
        size === "md" && "h-5.5 px-2 text-tag rounded-xs",
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
    <span className={cn("inline-flex items-center h-6 px-2.5 rounded-xs bg-sand text-on-sand text-tag uppercase", className)}>
      Mellocrush Plus
    </span>
  );
}

/** Generic status badge (Verified / Pending / Free / Plus) for list-row meta. */
export function StatusBadge({ children, tone = "neutral", className }: { children: ReactNode; tone?: TagVariant; className?: string }) {
  return (
    <span className={cn("inline-flex items-center h-5.5 px-2 rounded-xs text-tag", tagVariant[tone], className)}>
      {children}
    </span>
  );
}
