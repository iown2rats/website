"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/*
 * The page-view beacon (docs/ARCHITECTURE.md §30.4).
 *
 * TWO GUARDS AGAINST DUPLICATES, and they protect against different things.
 *
 * On the CLIENT, `sent` remembers the last path this mount actually reported. React Strict Mode runs every effect
 * twice on purpose; a re-render with the same pathname would re-run it too. Both cases find `sent.current` already
 * equal to the pathname and return without sending, so one navigation produces one request.
 *
 * On the SERVER, every request carries a freshly minted `eventKey` and the column is UNIQUE. That is what covers
 * the cases the client cannot see: a retried request, a beacon the browser redelivers, a page restored from the
 * back-forward cache. The two guards are not redundant — the client one avoids pointless traffic, the server one
 * is the guarantee.
 *
 * What deliberately DOES count as a new page view: a refresh (a new mount, so `sent` starts empty) and a genuine
 * navigation to a different path. Both are real views and the operator would be right to expect them.
 *
 * NOTHING HERE IDENTIFIES ANYBODY. The component reads one thing from the browser, `document.referrer`, and sends
 * one thing it generated, a random UUID. It sets no cookie, reads no cookie (both are HttpOnly and invisible to
 * it), touches no storage, and probes no device property. Who the visitor is, if anyone, is resolved on the
 * server from the session cookie.
 */

const ENDPOINT = "/api/analytics/collect";

/** Fire-and-forget. `keepalive` lets the request outlive the page so a view is not lost on a fast exit. */
function send(body: { eventKey: string; type: "PAGE_VIEW"; path: string; referrer: string | null }): void {
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "same-origin",
      // Measurement must never delay or interfere with the page: no cache entry, no redirect following.
      cache: "no-store",
      redirect: "error",
    }).catch(() => {});
  } catch {
    /* A browser that refuses the request simply is not measured. */
  }
}

function newKey(): string {
  // randomUUID needs a secure context; every real deployment has one. The fallback keeps development working
  // over plain http rather than silently dropping every view.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(8)}${hex(4)}`;
}

export function AnalyticsTracker() {
  const pathname = usePathname();
  const sent = useRef<string | null>(null);
  /** The referrer is only meaningful for the visit's first page; afterwards it is our own previous page. */
  const first = useRef(true);

  useEffect(() => {
    if (!pathname) return;
    // Strict Mode's second invocation, and any re-render that did not change the path, stop here.
    if (sent.current === pathname) return;
    sent.current = pathname;

    const referrer = first.current && typeof document !== "undefined" ? document.referrer || null : null;
    first.current = false;

    // The path is sent as the browser has it and normalised on the server; the server never trusts this value.
    send({ eventKey: newKey(), type: "PAGE_VIEW", path: pathname, referrer });
  }, [pathname]);

  return null;
}
