import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { BrandMark, Wordmark } from "@/components/brand/logo";

/*
 * Header patterns from the prototype:
 *  - TabHeader: 48 px row inside the screen gutter; h1 26 px/800 (or the wordmark on Discover); trailing 44 px controls.
 *  - PageHeader: 56 px + safe-top; 44 px ghost back button; 19 px/800 title; optional trailing action (e.g. "Save").
 *  - GlassHeader: conversation header — glass + blur 16, bottom border.
 */

/**
 * Tab-level header. `compactLogo` keeps only the linked "oo" mark on the narrowest phones (< 390 px) when the actions
 * area is temporarily wider than usual (e.g. Discover while a Boost countdown is showing), so nothing wraps or clips.
 */
export function TabHeader({ title, logo = false, compactLogo = false, actions, className }: { title?: string; logo?: boolean; compactLogo?: boolean; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex h-12 shrink-0 items-center justify-between gap-2", className)}>
      {logo ? (
        <div className="flex min-w-0 items-center gap-2 text-h3 text-text">
          <Wordmark height={24} className={cn(compactLogo && "max-[389px]:hidden")} />
          {compactLogo ? <BrandMark size={28} className="min-[390px]:hidden" /> : null}
          {title ? <span className="sr-only">{title}</span> : null}
        </div>
      ) : (
        <h1 className="text-h1 text-text">{title}</h1>
      )}
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageHeader({
  title,
  onBack,
  backHref,
  action,
  className,
  glass = false,
}: {
  title: ReactNode;
  onBack?: () => void;
  backHref?: string;
  action?: ReactNode;
  className?: string;
  glass?: boolean;
}) {
  const back = onBack || backHref;
  return (
    <header
      className={cn("flex shrink-0 items-center gap-2 px-2", glass && "glass", className)}
      style={{ height: "calc(var(--page-header-height) + var(--safe-top))", paddingTop: "var(--safe-top)" }}
    >
      {back ? (
        backHref ? (
          <a href={backHref} aria-label="Back" className="grid size-11 place-items-center rounded-md text-text hover:bg-surface-muted">
            <ChevronLeftIcon size={22} strokeWidth={2.2} />
          </a>
        ) : (
          <IconButton aria-label="Back" variant="ghost" onClick={onBack}>
            <ChevronLeftIcon size={22} strokeWidth={2.2} />
          </IconButton>
        )
      ) : null}
      <h1 className="flex-1 min-w-0 truncate text-prompt font-extrabold text-text">{title}</h1>
      {action}
    </header>
  );
}
