import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/*
 * Layout primitives so screens never recompute safe-area / nav maths.
 *  - AppScreen: tab screen column with the prototype padding `calc(6px + safe-top) 16px 0`.
 *  - ScrollArea: internal scroller; `navSafe` reserves bottom clearance for the floating nav.
 *  - DiscoveryFrame: deck area — flex-1, relative, max-width 500 (560 at the desktop tier, where the card is the
 *    subject of the screen rather than a phone card floating in a large viewport).
 *  - PageFrame: full-screen page overlay body (max-width 640, or 900 for settings) centred.
 *  - SettingsFrame: desktop two-column (220 px section nav + content).
 *  - ModalBody: consistent dialog padding/gap.
 */

export function AppScreen({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("flex min-h-0 flex-1 flex-col px-4 pt-safe-header", className)} {...rest}>
      {children}
    </section>
  );
}

export function ScrollArea({ className, children, navSafe = true, ...rest }: HTMLAttributes<HTMLDivElement> & { navSafe?: boolean }) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", navSafe && "pb-nav desktop:pb-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function DiscoveryFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("relative mx-auto mt-1 min-h-0 w-full max-w-[var(--deck-max)] flex-1 mb-[calc(64px+var(--safe-bottom))] desktop:mb-0 wide:max-w-[var(--deck-wide)]", className)}
    >
      {children}
    </div>
  );
}

export function PageFrame({ children, wide = false, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-h-0 w-full flex-1 flex-col mx-auto", wide ? "max-w-[var(--settings-max)]" : "max-w-[var(--content-max)]", className)}>
      {children}
    </div>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden px-4 pt-1", className)} style={{ paddingBottom: "calc(20px + var(--safe-bottom))" }}>
      {children}
    </div>
  );
}

export function SettingsFrame({ sideNav, children }: { sideNav?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      {sideNav ? <nav aria-label="Sections" className="hidden desktop:flex w-52 shrink-0 flex-col gap-0.5 border-r border-border px-2.5 py-2">{sideNav}</nav> : null}
      <PageBody>{children}</PageBody>
    </div>
  );
}

/** Content column inside tab screens (Profile, Community). Section gap 14 after the compact pass (§32). */
export function Stack({ className, gap = "lg", ...rest }: HTMLAttributes<HTMLDivElement> & { gap?: "sm" | "md" | "lg" }) {
  return <div className={cn("flex flex-col", gap === "sm" && "gap-2", gap === "md" && "gap-3", gap === "lg" && "gap-3.5", className)} {...rest} />;
}

export function ModalBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-3", className)} {...rest} />;
}
