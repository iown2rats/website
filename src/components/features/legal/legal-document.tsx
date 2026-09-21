import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * The shared furniture for Mellocrush's public legal documents (docs/ARCHITECTURE.md §27): Terms & Conditions,
 * the Privacy Policy and the Community Guidelines.
 *
 * These are long documents that people read rather than use, so the only design decisions here are the ones that
 * serve reading: one measure capped at 68 characters or so, generous leading, and a heading scale that stays
 * visibly ordered at every step. Everything else — colours, type scale, glass, breakpoints — is the app's own.
 *
 * The heading levels are the document's structure, not its styling. Each page has exactly one <h1> and its numbered
 * clauses are <h2>, so a screen reader's heading list is the contract's table of contents. The supplied documents
 * have exactly those two levels; an <h3> is deliberately absent rather than invented, because a heading level that
 * does not exist in the text would put a structure in the document that its author did not write.
 */

/** One numbered clause. `id` gives it a stable anchor so a specific term can be linked to. */
export function Clause({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `${n}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="scroll-mt-6 text-h3 text-text">
        <span className="text-text-secondary">{n}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-body leading-relaxed text-text-secondary", className)}>{children}</p>;
}

/** A bulleted list. Legal prose leans on these heavily, so they are quiet: a small dash, not a heavy dot. */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-none flex-col gap-1.5 pl-0">
      {items.map((item, i) => (
        <li key={i} className="relative pl-5 text-body leading-relaxed text-text-secondary">
          <span aria-hidden="true" className="absolute left-0 top-[0.72em] h-px w-2.5 bg-border" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** An email address, as a working mailto. */
export function Mail({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className="font-medium text-primary underline decoration-primary/40 underline-offset-[3px] break-words">
      {address}
    </a>
  );
}

/** The contact block every document ends with. One list, one purpose per line. */
export function ContactBlock({ lines }: { lines: { label: string; address: string }[] }) {
  return (
    <dl className="flex flex-col gap-3 rounded-card bg-surface-muted p-4">
      {lines.map((l) => (
        <div key={l.address} className="flex flex-col gap-0.5">
          <dt className="text-caption text-text-secondary">{l.label}</dt>
          <dd className="text-body">
            <Mail address={l.address} />
          </dd>
        </div>
      ))}
      <div className="flex flex-col gap-0.5">
        <dt className="text-caption text-text-secondary">Website</dt>
        <dd className="text-body text-text">www.mellocrush.com</dd>
      </div>
    </dl>
  );
}

/**
 * A whole document: the title, the dates, the lead paragraph and the clauses.
 *
 * "Last updated" is stated as plain text rather than derived from a build date. A legal document's revision date is
 * a fact about the document, not about when it was last deployed, and the two must not be allowed to drift apart
 * by accident.
 */
export function LegalDocument({
  title,
  effective,
  updated,
  lead,
  children,
}: {
  title: string;
  effective: string;
  updated: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <h1 className="text-hero text-text">{title}</h1>
        <p className="text-caption text-text-secondary">
          Effective date: {effective}
          <span aria-hidden="true"> · </span>
          <span className="whitespace-nowrap">Last updated: {updated}</span>
        </p>
        <div className="flex flex-col gap-3">{lead}</div>
      </header>
      {children}
    </article>
  );
}

/** The three documents, so the footer and the cross-links cannot disagree about what exists. */
export const LEGAL_PAGES = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/community-guidelines", label: "Community Guidelines" },
] as const;

/** The public legal footer: the other two documents, and the way back. */
export function LegalFooter({ current }: { current?: string }) {
  return (
    <footer className="flex flex-col gap-3 border-t border-border pt-5">
      <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
        {LEGAL_PAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            aria-current={p.href === current ? "page" : undefined}
            className={cn("text-body-sm font-medium underline-offset-[3px]", p.href === current ? "text-text" : "text-text-secondary underline decoration-border")}
          >
            {p.label}
          </Link>
        ))}
      </nav>
      <p className="text-caption text-text-secondary">MelloCrush · www.mellocrush.com</p>
    </footer>
  );
}
