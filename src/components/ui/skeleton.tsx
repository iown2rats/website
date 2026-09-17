import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Loading placeholders in the prototype's geometry. Shimmer is opacity-only so reduced motion stays calm. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("bg-surface-muted animate-shimmer", className)} {...rest} />;
}

export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5 rounded-full", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Deck card placeholder: radius 26, fills the deck area. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0 rounded-card bg-surface-muted overflow-hidden animate-shimmer", className)} aria-hidden="true">
      <div className="absolute inset-x-4.5 bottom-5 flex flex-col gap-2.5">
        <Skeleton className="h-7 w-2/5 rounded-lg bg-border" />
        <Skeleton className="h-3.5 w-3/5 rounded-full bg-border" />
        <div className="flex gap-1.5">
          <Skeleton className="h-7 w-16 rounded-full bg-border" />
          <Skeleton className="h-7 w-14 rounded-full bg-border" />
          <Skeleton className="h-7 w-16 rounded-full bg-border" />
        </div>
      </div>
    </div>
  );
}

/** Conversation-row placeholder (52 px avatar). */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3.5 px-1.5 py-3", className)} aria-hidden="true">
      <Skeleton className="size-13 rounded-full" />
      <div className="flex-1 flex flex-col gap-2">
        <Skeleton className="h-3.5 w-1/3 rounded-full" />
        <Skeleton className="h-3 w-3/4 rounded-full" />
      </div>
    </div>
  );
}

/** 3:4 grid tile placeholder (Likes, Matches). */
export function SkeletonTile({ className }: { className?: string }) {
  return <Skeleton className={cn("aspect-[3/4] rounded-3xl", className)} />;
}
