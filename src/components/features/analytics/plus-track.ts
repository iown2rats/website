"use client";

import { useEffect, useRef } from "react";
import type { PlusSurface } from "@/lib/plus-surfaces";

/*
 * Reporting a Plus promotion to the funnel (docs/ARCHITECTURE.md §12.19). Fire-and-forget: nothing here is awaited
 * by a click handler, every failure is swallowed, and the endpoint answers 204 whatever it did — so a blocked
 * request, an offline phone or the switch being off all look the same and none of them can break the page.
 *
 * Only the step and the surface leave the browser. Never a count, a name, a handle or anything about who is behind
 * a promotion.
 */
const ENDPOINT = "/api/analytics/plus";

function send(event: "plus_prompt_viewed" | "plus_prompt_clicked", surface: PlusSurface, eventKey: string): void {
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventKey, event, surface }),
      // Survives the navigation a tap usually starts.
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* Analytics never throws into the UI. */
  }
}

/** A tap on a promotion's way forward. */
export function trackPlusClick(surface: PlusSurface): void {
  send("plus_prompt_clicked", surface, crypto.randomUUID());
}

/**
 * Reports one view each time `active` becomes true. The key is minted once per activation, so React's double-invoked
 * effects post the same key twice and the database keeps one row.
 */
export function usePlusPromptView(surface: PlusSurface | null | undefined, active: boolean): void {
  const key = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !surface) {
      key.current = null;
      return;
    }
    key.current ??= crypto.randomUUID();
    send("plus_prompt_viewed", surface, key.current);
  }, [active, surface]);
}
