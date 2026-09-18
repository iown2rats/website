import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { photoBackground, type PhotoRef } from "@/lib/photos";
import { VerifiedBadge } from "./icons";

/*
 * Avatars from the prototype: plain circles at 40/44/48/52/56/64; "new match" ring = 2.5 px primary border
 * with 2–3 px padding; profile ring 104 px with r=49 4 px arc showing completion.
 */

export type AvatarSize = 32 | 40 | 44 | 48 | 52 | 56 | 64 | 88;

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  photo?: PhotoRef | null;
  name: string;
  size?: AvatarSize;
  ring?: boolean;
}

export function Avatar({ photo, name, size = 44, ring = false, className, style, ...rest }: AvatarProps) {
  const pad = ring ? (size >= 64 ? 3 : 2) : 0;
  const inner: CSSProperties = { ...photoBackground(photo ?? null) };
  return (
    <span
      role="img"
      aria-label={name}
      className={cn("inline-block shrink-0 rounded-full", ring && "border-[2.5px] border-primary", className)}
      style={{ width: size, height: size, padding: pad, ...style }}
      {...rest}
    >
      <span className="block size-full rounded-full bg-aqua-soft" style={inner} />
    </span>
  );
}

export interface ProfileAvatarProps {
  photo?: PhotoRef | null;
  name: string;
  size?: 88 | 104;
  verified?: boolean;
  /** 0–100. Renders the completion arc when provided. */
  completion?: number;
  completionLabel?: string;
  className?: string;
}

/** Profile-tab avatar: optional completion ring (prototype 104 px, r 49, 4 px stroke) and teal "n% complete" pill. */
export function ProfileAvatar({ photo, name, size = 104, verified = false, completion, completionLabel, className }: ProfileAvatarProps) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const pct = completion == null ? null : Math.max(0, Math.min(100, completion));
  return (
    <span className={cn("relative inline-block", className)} style={{ width: size, height: size }}>
      {pct != null ? (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-600 ease-out"
          />
        </svg>
      ) : null}
      <span role="img" aria-label={name} className="absolute inset-2 rounded-full bg-aqua-soft" style={photoBackground(photo ?? null)} />
      {verified ? <VerifiedBadge size={22} className="absolute right-1 top-1" /> : null}
      {pct != null ? (
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-5.5 px-2.25 rounded-full bg-accent text-on-accent text-[11px] font-extrabold flex items-center whitespace-nowrap">
          {completionLabel ?? `${pct}% complete`}
        </span>
      ) : null}
    </span>
  );
}
