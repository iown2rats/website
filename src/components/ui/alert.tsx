import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { InfoIcon } from "./icons";

/*
 * Callouts: prototype info callout = aqua-soft background, ocean text, radius 18, padding 14px 16px, 13 px/1.5, 18 px icon.
 * The dark-mode contrast fix lives in the --on-aqua-soft token. Ocean variant = dark notice card (privacy screen).
 */
export type CalloutTone = "info" | "success" | "warning" | "danger" | "ocean";

const tones: Record<CalloutTone, string> = {
  info: "bg-aqua-soft text-on-aqua-soft",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/10 text-danger",
  ocean: "bg-ocean text-on-ocean-muted [&_svg]:text-aqua rounded-3xl p-5",
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
      className={cn("flex gap-2.5 items-start rounded-xl px-4 py-3.5 text-caption leading-normal", tones[tone], className)}
      {...rest}
    >
      <span className="shrink-0 mt-px [&>svg]:size-4.5" aria-hidden="true">
        {icon ?? <InfoIcon size={18} />}
      </span>
      <div className="min-w-0">
        {title ? <div className="font-bold text-body-sm mb-0.5">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}
