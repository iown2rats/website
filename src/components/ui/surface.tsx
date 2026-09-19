import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { ChevronRightIcon } from "./icons";

/*
 * Surfaces from the prototype:
 *  - Card: warm-white glass with the soft shadow, no outline, radius 24, padding 18 (post cards) / 22 (prompt cards, with shadow-sm).
 *  - Surface (inset): surface-muted, radius 18, padding 14–16 (intro prompt preview, support card radius 24 padding 20).
 *  - OceanCard (historic name): the trust card — teal-tint background, plum text, radius 24, padding 20–22 (privacy
 *    notice, contact blocking); `premium` = the Plus hero on a warm surface with a faint gold disc.
 *  - ListGroup: bordered surface, radius 20–24, rows 54–60 px separated by 1 px borders; row = label, meta, chevron.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md" | "lg";
  elevated?: boolean;
  radius?: "2xl" | "3xl";
}

/* Compact pass (docs/DESIGN_SYSTEM.md §32): 16 / 18 / 22 becomes 12 / 14 / 16. Borderless and glass as before. */
const cardPadding = { none: "", sm: "p-3", md: "p-3.5", lg: "p-4" };

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ padding = "md", elevated = false, radius = "3xl", className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={cn("glass-card", radius === "3xl" ? "rounded-3xl" : "rounded-2xl", elevated && "shadow-lg", cardPadding[padding], className)}
      {...rest}
    />
  );
});

export function Surface({ className, padding = "md", ...rest }: CardProps) {
  return <div className={cn("bg-surface-muted rounded-xl", cardPadding[padding], className)} {...rest} />;
}

export interface OceanCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Plus hero: warm surface with a faint gold disc instead of the teal trust tint. */
  premium?: boolean;
}

export function OceanCard({ className, premium = false, children, ...rest }: OceanCardProps) {
  return (
    <div className={cn("relative overflow-hidden rounded-3xl p-4 flex flex-col gap-2.5", "glass-card text-text", className)} {...rest}>
      {premium ? <span aria-hidden="true" className="absolute -right-15 -top-15 size-46 rounded-full bg-sand/15" /> : null}
      <div className="relative flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

export function Divider({ className, ...rest }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn("border-0 border-t border-border m-0", className)} {...rest} />;
}

export function ListGroup({ className, children, radius = "3xl", ...rest }: HTMLAttributes<HTMLDivElement> & { radius?: "2xl" | "3xl" }) {
  return (
    <div className={cn("glass-card overflow-hidden flex flex-col", radius === "3xl" ? "rounded-3xl" : "rounded-2xl", "[&>*+*]:border-t [&>*+*]:border-border", className)} {...rest}>
      {children}
    </div>
  );
}

export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  tone?: "default" | "danger";
  height?: 48 | 50 | 54;
  /** Render as a non-interactive row (e.g. toggles live inside). */
  asDiv?: boolean;
}

export function ListRow({ label, meta, leading, trailing, chevron = true, tone = "default", height = 50, asDiv = false, className, ...rest }: ListRowProps) {
  const content = (
    <>
      {leading}
      <span className="flex-1 min-w-0 text-body truncate">{label}</span>
      {meta ? <span className="text-caption text-text-secondary shrink-0">{meta}</span> : null}
      {trailing}
      {chevron && !asDiv ? <ChevronRightIcon size={16} className="text-text-secondary shrink-0" /> : null}
    </>
  );
  const classes = cn(
    "w-full flex items-center gap-3 px-3.5 text-left bg-transparent border-0",
    tone === "danger" ? "text-danger" : "text-text",
    !asDiv && "hover:bg-surface-muted transition-colors duration-150",
    className,
  );
  if (asDiv) {
    return (
      <div className={classes} style={{ minHeight: height }}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className={classes} style={{ minHeight: height }} {...rest}>
      {content}
    </button>
  );
}

/** ListRow rendered as a navigation link (Profile and Settings rows that open a page). */
export function LinkRow({ href, label, meta, leading, trailing, chevron = true, tone = "default", height = 50, className, ...rest }: Omit<ListRowProps, "asDiv" | "onClick"> & { href: string } & Omit<React.ComponentProps<typeof Link>, "href">) {
  return (
    <Link
      href={href}
      className={cn("w-full flex items-center gap-3 px-3.5 text-left bg-transparent border-0 hover:bg-surface-muted transition-colors duration-150", tone === "danger" ? "text-danger" : "text-text", className)}
      style={{ minHeight: height }}
      {...rest}
    >
      {leading}
      <span className="flex-1 min-w-0 text-body truncate">{label}</span>
      {meta ? <span className="text-caption text-text-secondary shrink-0">{meta}</span> : null}
      {trailing}
      {chevron ? <ChevronRightIcon size={16} className="text-text-secondary shrink-0" /> : null}
    </Link>
  );
}

/** Uppercase section label ("ABOUT ME", "NEW MATCHES") — 11.5 px / 500, not the old 12 / 700. */
export function SectionLabel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-label uppercase text-text-secondary", className)} {...rest} />;
}
