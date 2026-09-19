"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import { shortRelativeTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { CardIcon, ChatIcon, CheckIcon, HeartIcon, InfoIcon, PeopleIcon, ShieldIcon, type IconProps } from "@/components/ui/icons";
import type { NotificationDto, NotificationIcon } from "@/server/notifications/feed";

/*
 * Notification rows, shared by the bell's dropdown and the full page so both read identically (docs/DESIGN_SYSTEM.md §31).
 * A row is 40 px avatar or icon, the main line, a secondary line and the time — the layout of the reference dropdown.
 *
 * The row shows only what the server already decided it may show: a like the viewer has not paid to see arrives with
 * no name and no photo and renders the generic icon, so there is nothing here to hide and nothing to leak. A row whose
 * destination is gone (a deleted post) arrives with `href: null` and renders as a plain button that only marks itself
 * read, rather than a link to a page that would 404.
 */
const ICONS: Record<NotificationIcon, ComponentType<IconProps>> = {
  like: HeartIcon,
  match: PeopleIcon,
  message: ChatIcon,
  community: PeopleIcon,
  verification: CheckIcon,
  billing: CardIcon,
  safety: ShieldIcon,
  account: InfoIcon,
};

function RowBody({ item }: { item: NotificationDto }) {
  const Icon = ICONS[item.icon] ?? InfoIcon;
  return (
    <>
      {item.photo && item.actorName ? (
        <Avatar name={item.actorName} photo={{ url: item.photo.url, key: item.photo.demoKey, blurhash: item.photo.blurhash }} size={40} />
      ) : (
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted text-text-secondary">
          <Icon size={19} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={cn("min-w-0 flex-1 text-body-sm leading-snug text-text", item.read ? "font-semibold" : "font-extrabold")}>{item.title}</span>
          <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {item.read ? null : <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />}
            <time dateTime={item.createdAt} suppressHydrationWarning className="text-micro text-text-secondary">
              {shortRelativeTime(item.createdAt)}
            </time>
          </span>
        </span>
        {item.detail ? <span className="mt-0.5 block truncate text-caption text-text-secondary">{item.detail}</span> : null}
        {item.read ? null : <span className="sr-only">Unread</span>}
      </span>
    </>
  );
}

const ROW = "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted/70";

export function NotificationList({
  items,
  onOpen,
  className,
}: {
  items: NotificationDto[];
  /** Called before navigation so the row is marked read even when the click also leaves the screen. */
  onOpen: (item: NotificationDto) => void;
  className?: string;
}) {
  return (
    <ul className={cn("m-0 flex list-none flex-col divide-y divide-border p-0", className)}>
      {items.map((item) => (
        <li key={item.id} className={cn(item.read ? undefined : "bg-primary-soft/35")}>
          {item.href ? (
            <Link href={item.href} className={ROW} onClick={() => onOpen(item)}>
              <RowBody item={item} />
            </Link>
          ) : (
            <button type="button" className={ROW} onClick={() => onOpen(item)}>
              <RowBody item={item} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function NotificationsEmpty({ className }: { className?: string }) {
  return <p className={cn("px-4 py-8 text-center text-body-sm text-text-secondary", className)}>You&rsquo;re all caught up.</p>;
}
