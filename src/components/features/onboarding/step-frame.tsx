import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { ProgressBar, StepCounter } from "@/components/ui/progress";
import { TOTAL_STEPS } from "@/server/onboarding/stages";

/*
 * Onboarding/auth step chrome from the prototype: 44 px bordered back button (margin-left −8), 4 px progress bar,
 * "n / 12" counter; title 24/800, subtitle 14 secondary; scrolling content; CTA pinned at the bottom.
 * Column max-width 520, padding calc(8px + safe-top) 16px calc(12px + safe-bottom). Desktop keeps the same
 * focused column centred on the page.
 */
export interface StepFrameProps {
  step: number;
  title: string;
  subtitle?: string;
  backHref?: string | null;
  children: ReactNode;
  /** Pinned bottom area (usually the submit button rendered by the form). */
  footer?: ReactNode;
  className?: string;
}

export function StepFrame({ step, title, subtitle, backHref, children, footer, className }: StepFrameProps) {
  return (
    <div className="fixed inset-0 flex flex-col items-center overflow-hidden bg-background text-text">
      <div
        className={cn("flex min-h-0 w-full max-w-[var(--onboarding-max)] flex-1 flex-col px-4", className)}
        style={{ paddingTop: "calc(8px + var(--safe-top))", paddingBottom: "calc(12px + var(--safe-bottom))" }}
      >
        <div className="flex h-11 shrink-0 items-center gap-3.5">
          {backHref ? (
            <Link href={backHref} aria-label="Back" className="-ml-2 grid size-11 shrink-0 place-items-center rounded-md bg-surface-muted text-text hover:bg-border">
              <ChevronLeftIcon size={20} />
            </Link>
          ) : (
            <span aria-hidden="true" className="-ml-2 size-11 shrink-0" />
          )}
          <ProgressBar value={step} max={TOTAL_STEPS} label="Setup progress" />
          <StepCounter step={step} total={TOTAL_STEPS} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden pt-4.5 animate-fade-in">
          <h1 className="text-h2 text-text">{title}</h1>
          {subtitle ? <p className="-mt-1.5 text-body-sm text-text-secondary">{subtitle}</p> : null}
          {children}
        </div>
        {footer ? <div className="shrink-0 pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}
