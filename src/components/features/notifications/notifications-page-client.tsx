"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadNotifications, readAllNotifications, readNotification } from "@/actions/notifications";
import { NOTIFICATION_FEED } from "@/config/product";
import { useNotifications } from "@/components/layout/notifications-context";
import { Button } from "@/components/ui/button";
import { BellIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { ListGroup } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import type { NotificationDto, NotificationFeedDto } from "@/server/notifications/feed";
import { NotificationList } from "./notification-list";

/*
 * "See all notifications" — the same rows as the dropdown, paged. The first page is server-rendered; later pages
 * come from the same action the dropdown uses, with an opaque cursor so a page boundary between two rows created in
 * the same millisecond cannot drop one. Rows are never deleted here: marking read only stops them counting.
 */
export function NotificationsPageClient({ initial }: { initial: NotificationFeedDto }) {
  const router = useRouter();
  const toast = useToast();
  const { setUnread } = useNotifications();
  const [items, setItems] = useState<NotificationDto[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [unreadHere, setUnreadHere] = useState(initial.unread);
  const [busy, setBusy] = useState(false);

  const loadMore = async () => {
    if (!cursor) return;
    setBusy(true);
    const r = await loadNotifications({ limit: NOTIFICATION_FEED.pageSize, cursor }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "Couldn't load more right now.");
    // Guard against a row arriving twice if something new landed between pages.
    setItems((list) => [...list, ...r.items.filter((n) => !list.some((existing) => existing.id === n.id))]);
    setCursor(r.nextCursor);
    setUnread(r.unread);
    setUnreadHere(r.unread);
  };

  const openRow = (item: NotificationDto) => {
    if (item.read) return;
    setItems((list) => list.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnreadHere((n) => Math.max(0, n - 1));
    setUnread(Math.max(0, unreadHere - 1));
    void readNotification({ id: item.id })
      .then((r) => {
        if (r.ok) {
          setUnread(r.unread);
          setUnreadHere(r.unread);
        }
        router.refresh();
      })
      .catch(() => {});
  };

  const markAll = async () => {
    setBusy(true);
    const r = await readAllNotifications().catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return toast.show(r && !r.ok ? r.message : "Couldn't mark those as read.");
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
    setUnreadHere(0);
    router.refresh();
  };

  if (items.length === 0) {
    return (
      <EmptyState
        framed
        icon={<BellIcon />}
        title="You're all caught up."
        description="Likes, matches, messages and account updates land here."
      />
    );
  }

  return (
    <>
      {unreadHere > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-caption text-text-secondary">
            {unreadHere} unread {unreadHere === 1 ? "notification" : "notifications"}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void markAll()} disabled={busy}>
            Mark all as read
          </Button>
        </div>
      ) : null}
      <ListGroup className="[&>*+*]:border-t-0">
        <NotificationList items={items} onOpen={openRow} />
      </ListGroup>
      {cursor ? (
        <Button variant="secondary" size="md" fullWidth loading={busy} onClick={() => void loadMore()}>
          Show older
        </Button>
      ) : null}
      {/* The floating phone nav overlays this column, and the page-overlay body sets its bottom padding inline
          (which a class cannot override), so the clearance is a spacer rather than padding. */}
      <div aria-hidden="true" className="h-[var(--nav-clearance)] shrink-0 desktop:hidden" />
    </>
  );
}
