import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { InfoIcon } from "./icons";

/*
 * Callouts: info = tinted background, plum text, radius 16, padding 10px 14px, 12.5 px/1.5, 16 px icon (§32).
 * The "ocean" tone (historic name) is the premium card: warm surface, gold edge and icon, used when Plus is active.
 */
export type CalloutTone = "info" | "success" | "warning" | "danger" | "ocean";

const tones: Record<CalloutTone, string> = {
  info: "bg-aqua-soft text-on-aqua-soft [&_svg]:text-accent",
  success: "bg-aqua-soft text-on-aqua-soft [&_svg]:text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/10 text-danger",
  ocean: "glass-card text-text [&_svg]:text-sand rounded-3xl p-4",
};

export interface CalloutProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CalloutTone;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}

export function Callout({ tone = "info", icon, title, children, className, role, ...rest }: CalloutProps) {
  return (
    <div
      role={role ?? (tone === "danger" || tone === "warning" ? "alert" : "note")}
      className={cn("flex gap-2 items-start rounded-lg px-3.5 py-2.5 text-caption leading-normal", tones[tone], className)}
      {...rest}
    >
      <span className="shrink-0 mt-px [&>svg]:size-4.5" aria-hidden="true">
        {icon ?? <InfoIcon size={18} />}
      </span>
      <div className="min-w-0">
        {title ? <div className="font-medium text-body-sm mb-0.5">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}
