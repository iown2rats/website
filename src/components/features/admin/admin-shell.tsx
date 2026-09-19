"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CounterBadge } from "@/components/ui/badge";
import { BottomSheet, DialogTitle } from "@/components/ui/dialog";
import { BrandMark, Wordmark } from "@/components/brand/logo";
import { BoltIcon, CheckIcon, ImageIcon, InfoIcon, LockIcon, MoreIcon, PeopleIcon, PinIcon, SendIcon, ShieldIcon, WavesIcon, type IconProps } from "@/components/ui/icons";
import { ThemeToggleButton } from "@/components/layout/theme-toggle";
import { hasPermission, type AdminRole, type Permission } from "@/server/admin/permissions";

/*
 * Admin frame (docs/DESIGN_SYSTEM.md §18). Desktop (≥ 900): 232 px sidebar with grouped navigation, content up to
 * 1100 px. Phone: a 56 px top bar with the section name and a Menu button that opens the same navigation as a
 * bottom sheet, so every admin screen and action is reachable one-handed. Navigation is filtered by role for tidiness
 * only; every page and action re-checks authorization on the server.
 */
export interface AdminNavBadges {
  payments?: number;
  reports?: number;
  verifications?: number;
  photos?: number;
}

interface NavItem {
  key: keyof AdminNavBadges | "dashboard" | "users" | "plans" | "methods" | "subscriptions" | "audit";
  label: string;
  href: string;
  Icon: ComponentType<IconProps>;
  permission: Permission;
  exact?: boolean;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ key: "dashboard", label: "Dashboard", href: "/admin", Icon: InfoIcon, permission: "dashboard.view", exact: true }] },
  {
    title: "People",
    items: [
      { key: "users", label: "Users", href: "/admin/users", Icon: PeopleIcon, permission: "users.view" },
      { key: "reports", label: "Reports", href: "/admin/reports", Icon: ShieldIcon, permission: "reports.act" },
      { key: "verifications", label: "Verifications", href: "/admin/verifications", Icon: CheckIcon, permission: "verification.act" },
      { key: "photos", label: "Photos", href: "/admin/photos", Icon: ImageIcon, permission: "photos.moderate" },
    ],
  },
  {
    title: "Revenue",
    items: [
      { key: "payments", label: "Payments", href: "/admin/payments", Icon: SendIcon, permission: "payments.review" },
      { key: "subscriptions", label: "Subscriptions", href: "/admin/subscriptions", Icon: WavesIcon, permission: "subscriptions.view" },
      { key: "plans", label: "Plans", href: "/admin/plans", Icon: BoltIcon, permission: "plans.manage" },
      { key: "methods", label: "Payment methods", href: "/admin/payments/methods", Icon: LockIcon, permission: "payment-methods.manage" },
    ],
  },
  { title: "System", items: [{ key: "audit", label: "Audit log", href: "/admin/audit", Icon: PinIcon, permission: "audit.view" }] },
];

function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  if (item.href === "/admin/payments") return pathname.startsWith("/admin/payments") && !pathname.startsWith("/admin/payments/methods");
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function NavList({ role, badges, pathname, onNavigate, dense = false }: { role: AdminRole; badges: AdminNavBadges; pathname: string; onNavigate?: () => void; dense?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((g) => {
        const items = g.items.filter((it) => hasPermission(role, it.permission));
        if (items.length === 0) return null;
        return (
          <div key={g.title} className="flex flex-col gap-1">
            <div className="px-3 text-label uppercase text-text-secondary">{g.title}</div>
            {items.map((it) => {
              const active = isActive(it, pathname);
              const count = it.key in badges ? (badges[it.key as keyof AdminNavBadges] ?? 0) : 0;
              return (
                <Link key={it.key} href={it.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 text-body-sm font-medium transition-colors", dense ? "h-11" : "h-11", active ? "bg-surface-muted text-text" : "text-text-secondary hover:bg-surface-muted")}>
                  <it.Icon size={20} className={active ? "text-text" : "text-text-secondary"} />
                  <span className="flex-1">{it.label}</span>
                  {count > 0 ? <CounterBadge count={count} aria-label={`${count} waiting`} /> : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function AdminShell({ role, badges = {}, children }: { role: AdminRole; badges?: AdminNavBadges; children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = GROUPS.flatMap((g) => g.items).find((it) => isActive(it, pathname));
  return (
    <div className="fixed inset-0 flex bg-background text-text">
      <aside className="hidden desktop:flex w-[var(--sidebar-width)] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border px-3.5 py-5">
        <Link href="/admin" className="flex items-center gap-2 px-3 text-h4 text-text" aria-label="Mellocrush admin home">
          <Wordmark height={22} />
          <span className="rounded-xs bg-ocean px-1.5 py-0.5 text-tag font-medium uppercase text-on-ocean">Admin</span>
        </Link>
        <NavList role={role} badges={badges} pathname={pathname} />
        <div className="mt-auto flex flex-col gap-2">
          <Link href="/discover" className="flex h-11 items-center gap-3 rounded-lg px-3 text-body-sm font-medium text-text-secondary hover:bg-surface-muted">‹ Back to Mellocrush</Link>
          <ThemeToggleButton className="h-11 rounded-md" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 desktop:hidden" style={{ height: "calc(var(--page-header-height) + var(--safe-top))", paddingTop: "var(--safe-top)" }}>
          <Link href="/admin" className="flex items-center gap-1.5 text-body font-medium" aria-label="Admin home">
            <BrandMark size={24} />
            <span className="rounded-xs bg-ocean px-1.5 py-0.5 text-tag font-medium uppercase text-on-ocean">Admin</span>
          </Link>
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-text-secondary">{current?.label ?? "Admin"}</span>
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open admin menu" className="grid size-11 place-items-center rounded-md text-text hover:bg-surface-muted">
            <MoreIcon size={22} />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 desktop:px-6 desktop:py-6" style={{ paddingBottom: "calc(24px + var(--safe-bottom))" }}>
          <div className="mx-auto w-full max-w-[1100px]">{children}</div>
        </main>
      </div>
      <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} label="Admin menu">
        <DialogTitle>Admin</DialogTitle>
        <NavList role={role} badges={badges} pathname={pathname} onNavigate={() => setMenuOpen(false)} dense />
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <Link href="/discover" onClick={() => setMenuOpen(false)} className="flex h-11 items-center gap-3 rounded-lg px-3 text-body-sm font-medium text-text-secondary hover:bg-surface-muted">‹ Back to Mellocrush</Link>
          <ThemeToggleButton className="h-11 rounded-md" />
        </div>
      </BottomSheet>
    </div>
  );
}
