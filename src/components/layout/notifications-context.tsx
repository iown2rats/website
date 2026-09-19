"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/*
 * The unread count shared by the bell in every tab header. The authenticated layout already counts unread rows
 * once per request, so the bell starts with the right number and adds no request of its own; the dropdown fetches
 * the rows themselves only when it is opened. Marking rows read updates the count here immediately, and a
 * `router.refresh()` lets the next server render agree (docs/ARCHITECTURE.md §13).
 */
interface NotificationsState {
  unread: number;
  setUnread: (n: number) => void;
}

const NotificationsContext = createContext<NotificationsState>({ unread: 0, setUnread: () => {} });

export function NotificationsProvider({ unread, children }: { unread: number; children: ReactNode }) {
  // A fresh server count wins: the layout re-renders on every navigation, so `unread` is the authority whenever it
  // changes. Between navigations `current` carries what the member has just read, without another round trip.
  const [fromServer, setFromServer] = useState(unread);
  const [current, setCurrent] = useState(unread);
  if (fromServer !== unread) {
    setFromServer(unread);
    setCurrent(unread);
  }

  const setUnread = useCallback((n: number) => setCurrent(Math.max(0, n)), []);
  const value = useMemo<NotificationsState>(() => ({ unread: current, setUnread }), [current, setUnread]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext);
}

/** Badge text from the prototype's counter rules: exact up to 9, then "9+". Zero renders no badge at all. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}
