import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { StatusBadge, type TagVariant } from "@/components/ui/badge";

/*
 * Operational building blocks for /admin (docs/DESIGN_SYSTEM.md §18). Same tokens as the app (surfaces, borders,
 * Plus Jakarta Sans, aqua accents) but denser and text-first: no photo cards, no hero gradients. Everything stacks
 * on a phone and spreads into columns from 900 px.
 */

export function AdminPage({ title, description, actions, children, backHref }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; backHref?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        {backHref ? <Link href={backHref.href} className="text-caption font-semibold text-primary-ink hover:underline">‹ {backHref.label}</Link> : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-h3 text-text">{title}</h1>
            {description ? <p className="mt-1 text-body-sm text-text-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      </header>
      {children}
    </div>
  );
}

export function Panel({ title, description, children, className, actions }: { title?: string; description?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface", className)}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-body font-bold text-text">{title}</h2>
            {description ? <p className="text-caption text-text-secondary">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint?: string; tone?: "default" | "attention" }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4", tone === "attention" && "border-warning/50 bg-warning/5")} title={hint}>
      <span className="text-label uppercase text-text-secondary">{label}</span>
      <span className="text-h2 text-text tabular-nums">{value}</span>
      {hint ? <span className="text-caption-sm leading-snug text-text-secondary">{hint}</span> : null}
    </div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 desktop:grid-cols-4", className)}>{children}</div>;
}

/** Key/value rows for detail screens. Values wrap; long identifiers use a monospace face. */
export function KeyValueList({ items, className }: { items: { label: string; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 desktop:grid-cols-2", className)}>
      {items.map((it) => (
        <div key={it.label} className="flex flex-col gap-0.5 border-b border-border pb-2.5 last:border-0 desktop:[&:nth-last-child(2)]:border-0">
          <dt className="text-label uppercase text-text-secondary">{it.label}</dt>
          <dd className={cn("min-w-0 break-words text-body-sm text-text", it.mono && "font-mono text-caption")}>{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Filter pills rendered as links, so filters survive refresh and work without JavaScript. */
export function FilterLinks({ items, current, label = "Filter" }: { items: { value: string; label: string; href: string; count?: number }[]; current: string; label?: string }) {
  return (
    <nav aria-label={label} className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
      {items.map((it) => {
        const active = it.value === current;
        return (
          <Link key={it.value} href={it.href} aria-current={active ? "page" : undefined} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-caption font-bold", active ? "border-primary bg-primary text-on-primary" : "border-border bg-surface text-text-secondary hover:bg-surface-muted")}>
            {it.label}
            {it.count !== undefined ? <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/40" : "bg-surface-muted")}>{it.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** A list row that is a link. Stacks on phones; primary / secondary / trailing on wider screens. */
export function RowLink({ href, primary, secondary, trailing, badges }: { href: string; primary: ReactNode; secondary?: ReactNode; trailing?: ReactNode; badges?: ReactNode }) {
  return (
    <Link href={href} className="flex flex-col gap-1.5 border-b border-border px-4 py-3 last:border-0 hover:bg-surface-muted desktop:flex-row desktop:items-center desktop:gap-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-sm font-bold text-text">{primary}</div>
        {secondary ? <div className="truncate text-caption text-text-secondary">{secondary}</div> : null}
      </div>
      {badges ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}
      {trailing ? <div className="text-caption text-text-secondary desktop:text-right desktop:w-40 desktop:shrink-0">{trailing}</div> : null}
    </Link>
  );
}

export function RowList({ children, empty }: { children: ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="px-4 py-10 text-center text-body-sm text-text-secondary">{empty}</p>;
  return <div className="rounded-2xl border border-border bg-surface">{children}</div>;
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-caption text-text-secondary">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Link href={hrefFor(page - 1)} className="rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-surface-muted">Previous</Link> : null}
        {page < pages ? <Link href={hrefFor(page + 1)} className="rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-surface-muted">Next</Link> : null}
      </div>
    </div>
  );
}

const STATUS_TONES: Record<string, TagVariant> = {
  ACTIVE: "success",
  ONBOARDING: "neutral",
  SUSPENDED: "warning",
  BANNED: "danger",
  DELETED: "neutral",
  AWAITING_PAYMENT: "neutral",
  SUBMITTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  OPEN: "warning",
  UNDER_REVIEW: "warning",
  RESOLVED: "success",
  DISMISSED: "neutral",
  VERIFIED: "success",
  SELFIE_SUBMITTED: "warning",
  NONE: "neutral",
  PHONE_VERIFIED: "neutral",
  PLUS: "plus",
  FREE: "neutral",
  ADMIN: "aqua",
  MODERATOR: "aqua",
  USER: "neutral",
  TRIALING: "success",
  PAST_DUE: "warning",
  MATCH: "success",
  PARTIAL_MATCH: "aqua",
  REVIEW_REQUIRED: "warning",
  MISMATCH: "danger",
  OCR_FAILED: "neutral",
  UNSUPPORTED_RECEIPT: "neutral",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <StatusBadge tone={STATUS_TONES[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ")}</StatusBadge>;
}

export function Mono({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("font-mono text-caption text-text", className)} {...rest}>{children}</span>;
}

export function DefinitionList({ definitions }: { definitions: Record<string, string> }) {
  return (
    <details className="rounded-2xl border border-border bg-surface px-4 py-3 text-body-sm">
      <summary className="cursor-pointer font-bold text-text">What each number means</summary>
      <dl className="mt-3 flex flex-col gap-2">
        {Object.entries(definitions).map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-caption text-text-secondary">{k}</dt>
            <dd className="text-caption text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
