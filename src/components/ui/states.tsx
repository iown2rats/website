import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { WifiOffIcon } from "./icons";

/*
 * Empty / error / offline states in the prototype's language: 72 px aqua-soft disc with a 30 px primary-pressed icon,
 * 20–22 px/800 title, 14 px secondary body (max 260 px), optional actions. Centred with 50–60 px vertical padding.
 */

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  /** Dashed outline variant used for the empty deck. */
  framed?: boolean;
}

export function EmptyState({ icon, title, description, actions, className, framed = false }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3",
        framed ? "rounded-card glass-card p-8" : "px-6 py-12",
        className,
      )}
    >
      <span className="grid place-items-center size-18 rounded-full bg-aqua-soft text-primary-ink [&>svg]:size-7.5" aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-h4 text-text">{title}</h2>
      {description ? <p className="text-body-sm text-text-secondary max-w-65">{description}</p> : null}
      {actions ? <div className="flex gap-2.5 mt-1.5 flex-wrap justify-center">{actions}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "Mellocrush couldn't load this right now. Try again in a moment.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 15c3-4 6-4 9 0s6 4 9 0" />
          <path d="M12 3v6M12 12h.01" />
        </svg>
      }
      title={title}
      description={description}
      actions={onRetry ? <Button variant="secondary" size="md" onClick={onRetry}>Try again</Button> : undefined}
    />
  );
}

/** Slim banner shown while the browser reports it is offline. Sending is disabled by the owning screen. */
export function OfflineBanner({ className }: { className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-2.5 px-4 h-11 rounded-lg bg-ocean text-on-ocean text-body-sm font-semibold", className)}>
      <WifiOffIcon size={18} className="shrink-0 text-aqua" />
      {"You're offline. We'll reconnect automatically."}
    </div>
  );
}

/** Success moment: teal disc with check and two ripple rings (prototype onboarding done / match). */
export function SuccessMark({ size = 120, className, label = "Done" }: { size?: number; className?: string; label?: string }) {
  const inner = Math.round(size * 0.73);
  return (
    <span role="img" aria-label={label} className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-aqua opacity-50 motion-ok:animate-ripple" />
      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-aqua opacity-50 motion-ok:animate-ripple [animation-delay:1.2s]" />
      <span className="relative grid place-items-center rounded-full like-gradient" style={{ width: inner, height: inner }}>
        <svg width={Math.round(inner * 0.41)} height={Math.round(inner * 0.41)} viewBox="0 0 24 24" fill="none" stroke="var(--on-primary)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12l5 5L20 7" />
        </svg>
      </span>
    </span>
  );
}
