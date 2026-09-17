import { cn } from "@/lib/cn";

/** 4 px progress track (onboarding): border-coloured track, primary fill, width transition 350 ms ease-out-soft. */
export function ProgressBar({ value, max = 100, label, className }: { value: number; max?: number; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn("h-1 w-full rounded-[2px] bg-border overflow-hidden", className)}
    >
      <div className="h-full rounded-[2px] bg-primary transition-[width] duration-350 ease-soft" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Step counter "4 / 12" as used beside the onboarding progress bar. */
export function StepCounter({ step, total, className }: { step: number; total: number; className?: string }) {
  return (
    <span className={cn("text-micro text-text-secondary min-w-9 text-right tabular-nums", className)} aria-label={`Step ${step} of ${total}`}>
      {step} / {total}
    </span>
  );
}
