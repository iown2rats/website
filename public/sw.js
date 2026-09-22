/*
 * MelloCrush service worker — push display and deep linking (docs/ARCHITECTURE.md §29.6).
 *
 * Deliberately the smallest service worker that can do this job. It does NOT cache, intercept or rewrite a single
 * request: a dating app whose pages are rendered per request behind a session has nothing to gain from an offline
 * cache and a great deal to lose from one serving a stale profile or somebody else's chat from disk. `fetch` is
 * not handled at all, so every request goes to the network exactly as if this file did not exist.
 *
 * Served from /sw.js rather than bundled, because a service worker's scope is its own directory: a file under
 * /_next/ could only control /_next/. It is plain JavaScript for the same reason — nothing compiles it.
 *
 * WHAT ARRIVES HERE has already been stripped of anything private by the server (src/server/notifications/
 * push-copy.ts): a title, one line of body, a URL on our origin and a tag. No message text, ever. This file adds
 * nothing to it and reads nothing from the page.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close, so a member who just granted permission
  // gets a worker that can actually receive the first push.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * A path on our own origin, or "/".
 *
 * `startsWith("/")` is NOT enough on its own: "//example.com" also starts with a slash, and `new URL` resolves it
 * to https://example.com — a protocol-relative URL is how an open redirect usually gets written by accident. The
 * server only ever emits the fixed set of paths in push-copy.ts, and Web Push payloads are encrypted end to end
 * so nobody else can author one, but a destination is the one field in a notification that moves somebody
 * somewhere, and it costs two characters to make that impossible rather than merely unlikely.
 */
function safePath(value) {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload is not worth a silent failure: show the neutral form rather than nothing, because the
    // member does have something waiting even if we cannot say what.
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : "MelloCrush";
  const body = typeof payload.body === "string" ? payload.body : "Open MelloCrush to see what's new";
  const url = safePath(payload.url);
  // Same tag replaces rather than stacks, so a member returning after an hour away finds one notification per
  // conversation instead of eleven.
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag : "mellocrush";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: false,
      // A fixed path in /public, not the content-hashed icon the manifest uses: a notification is drawn fresh
      // every time, so there is nothing to pin, and a service worker cannot see the build's hashed URLs anyway.
      icon: "/notification-icon.png",
      badge: "/notification-icon.png",
      // The destination travels in data, not in the tag or the title, so nothing about it is displayed.
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = safePath(data.url);

  event.waitUntil(
    (async () => {
      const url = new URL(target, self.location.origin).href;
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse a tab that is already open on this origin rather than piling up windows.
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ("navigate" in client) {
          const focused = await client.focus();
          await focused.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

/*
 * The push service can retire a subscription on its own — a browser idle for months, a key rotation. The browser
 * tells us here, and the page re-registers on its next visit; nothing is lost because the server independently
 * disables endpoints that answer 404 or 410.
 */
self.addEventListener("pushsubscriptionchange", () => {
  // Nothing to do without a session: re-subscribing needs an authenticated call, which only a page can make.
});
