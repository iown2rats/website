"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { loadNotifications, readAllNotifications, readNotification } from "@/actions/notifications";
import { NOTIFICATION_FEED } from "@/config/product";
import { cn } from "@/lib/cn";
import { badgeLabel, useNotifications } from "@/components/layout/notifications-context";
import { IconButton } from "@/components/ui/button";
import { BellIcon } from "@/components/ui/icons";
import type { NotificationDto } from "@/server/notifications/feed";
import { NotificationList, NotificationsEmpty } from "./notification-list";

/*
 * The bell and its dropdown (docs/DESIGN_SYSTEM.md §31), modelled on the reference: a floating card anchored under
 * the bell and aligned to its right edge, over a page that stays visible and undimmed. It is deliberately NOT a
 * bottom sheet on phones — it is the same card, sized to the viewport (78vw, 380–420 px from the desktop tier).
 *
 * The card extends leftwards from the bell, so the bell has to be the rightmost control in the header for it to
 * land inside the viewport; TabHeader renders it after every screen control for exactly that reason.
 *
 * The count comes from the layout's per-request query, so the bell costs nothing until it is opened; the rows are
 * fetched on open and refreshed on every open. There is no polling and no socket — the existing per-navigation
 * server render is what keeps the count honest, and `router.refresh()` after a read makes that happen immediately.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { unread, setUnread } = useNotifications();
  const router = useRouter();
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [marking, setMarking] = useState(false);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) bellRef.current?.focus();
  }, []);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const r = await loadNotifications({ limit: NOTIFICATION_FEED.dropdownSize }).catch(() => null);
    setLoading(false);
    if (!r || !r.ok) return setFailed(true);
    setItems(r.items);
    setUnread(r.unread);
  }, [setUnread]);

  // Opening pulls the rows fresh; closing leaves the last list in place so reopening is not a blank flash.
  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    void fetchFeed();
  };

  // Outside click and Escape. Pointerdown (not click) so a press that starts outside closes before anything else.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const openRow = (item: NotificationDto) => {
    setOpen(false);
    if (item.read) return;
    setItems((list) => list?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? list);
    setUnread(Math.max(0, unread - 1));
    void readNotification({ id: item.id })
      .then((r) => {
        if (r.ok) setUnread(r.unread);
        router.refresh();
      })
      .catch(() => {});
  };

  const markAll = async () => {
    setMarking(true);
    const r = await readAllNotifications().catch(() => null);
    setMarking(false);
    if (!r || !r.ok) return setFailed(true);
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? list);
    setUnread(0);
    router.refresh();
  };

  const badge = badgeLabel(unread);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <IconButton
        ref={bellRef}
        variant="ghost"
        className="relative"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        <BellIcon size={22} strokeWidth={2.1} />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-tag font-medium leading-none text-on-primary"
          >
            {badge}
          </span>
        ) : null}
      </IconButton>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 flex w-[78vw] max-w-[calc(100vw-1.25rem)] flex-col overflow-hidden",
            "rounded-2xl glass-card animate-fade-in desktop:w-[400px]",
          )}
        >
          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
            <h2 className="text-body-sm font-medium text-text">Notifications</h2>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAll()}
                disabled={marking}
                className="shrink-0 text-caption font-medium text-primary-ink disabled:opacity-50 hover:underline"
              >
                Mark all as read
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border max-h-[min(60svh,420px)]">
            {items === null && loading ? <DropdownSkeleton /> : null}
            {items !== null && items.length === 0 && !loading ? <NotificationsEmpty /> : null}
            {items !== null && items.length > 0 ? <NotificationList items={items} onOpen={openRow} /> : null}
            {failed ? (
              <p role="alert" className="px-4 py-6 text-center text-caption text-text-secondary">
                Couldn&rsquo;t load your notifications.{" "}
                <button type="button" onClick={() => void fetchFeed()} className="font-medium text-primary-ink hover:underline">
                  Try again
                </button>
              </p>
            ) : null}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="border-t border-border px-4 py-3 text-center text-caption font-medium text-primary-ink hover:bg-surface-muted/70"
          >
            See all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function DropdownSkeleton() {
  return (
    <ul aria-hidden="true" className="m-0 flex list-none flex-col divide-y divide-border p-0">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3 animate-shimmer">
          <span className="size-10 shrink-0 rounded-full bg-surface-muted" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-3 w-2/3 rounded-full bg-surface-muted" />
            <span className="h-2.5 w-1/3 rounded-full bg-surface-muted" />
          </span>
        </li>
      ))}
    </ul>
  );
}
