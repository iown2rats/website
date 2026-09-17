"use client";

import { useCallback, useRef } from "react";

/**
 * Server time, not device time (Phase 6 §27). Every action response carries `serverNow`; the client keeps the
 * offset between that and its own clock and renders countdowns from `resetAt - serverTime()`. Enforcement
 * never depends on this: the server rejects a like regardless of what the countdown shows.
 */
export function useServerClock(initialServerNow: string) {
  const offset = useRef<number | null>(null);
  const initial = useRef(initialServerNow);
  const sync = useCallback((serverNow: string) => {
    const parsed = Date.parse(serverNow);
    if (!Number.isNaN(parsed)) offset.current = parsed - Date.now();
  }, []);
  const serverTime = useCallback(() => {
    if (offset.current == null) offset.current = Date.parse(initial.current) - Date.now();
    return Date.now() + offset.current;
  }, []);
  return { sync, serverTime };
}
