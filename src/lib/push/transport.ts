/**
 * Sending one encrypted push to one endpoint (docs/ARCHITECTURE.md §29.3).
 *
 * This is the ONLY place that talks to a push service, and it is deliberately thin: it takes an endpoint, a
 * payload and keys, and reports what happened in terms the delivery engine can act on. It makes no decision about
 * whether a push should be sent — that is settled long before anything reaches here.
 *
 * WHAT THE PUSH SERVICE CAN SEE. Web Push (RFC 8291) encrypts the payload with a key pair the BROWSER generated
 * and a shared secret only that browser and this server hold; the service relays an opaque blob. It learns that
 * an endpoint received something and how big it was, and nothing else. That is worth stating precisely because
 * the obvious worry — "the push service can read these" — is answered by the protocol rather than by trust. It is
 * also NOT the reason message text is excluded: text is excluded because a lock screen is not private, and that
 * would still be true if the transport were perfect.
 *
 * VAPID (RFC 8292) is the other half: a keypair identifying this server to the push service. It is ours, it is
 * generated locally, and there is no account anywhere.
 */
import webpush, { WebPushError } from "web-push";
import { getEnv, webPushConfigured } from "@/lib/env";

/** What the caller must do next. The distinction that matters is permanent versus worth-another-go. */
export type PushSendResult =
  | { outcome: "sent" }
  /** 404/410: the subscription is gone for good. Disable it; never try again. */
  | { outcome: "gone"; status: number }
  /** Anything else — a timeout, a 500, a rate limit. Countable, retryable, not fatal. */
  | { outcome: "failed"; status: number | null; error: string };

export interface PushTarget {
  endpoint: string;
  /** The browser's own keys. Never logged, never returned, never stored anywhere but the device row. */
  keys: { p256dh: string; auth: string };
}

/** The JSON the service worker receives. Small by design; see push-copy.ts for what may be in it. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Collapses an older notification for the same thing rather than stacking two on the lock screen. */
  tag: string;
}

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const env = getEnv();
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  configured = true;
}

/**
 * Sends one push. Never throws: a push service having a bad minute is an outcome to record, not an exception to
 * propagate into a request that was only trying to deliver a courtesy.
 */
export async function sendWebPush(target: PushTarget, payload: PushPayload, ttlSeconds = 60 * 60 * 24): Promise<PushSendResult> {
  if (!webPushConfigured()) return { outcome: "failed", status: null, error: "web push is not configured" };
  try {
    ensureConfigured();
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: target.keys },
      JSON.stringify(payload),
      { TTL: ttlSeconds, urgency: "normal" },
    );
    return { outcome: "sent" };
  } catch (e) {
    if (e instanceof WebPushError) {
      // 404 Not Found / 410 Gone are the push services' way of saying this endpoint will never work again —
      // permission revoked, browser data cleared, the app uninstalled. Retrying is pure waste.
      if (e.statusCode === 404 || e.statusCode === 410) return { outcome: "gone", status: e.statusCode };
      return { outcome: "failed", status: e.statusCode, error: `push service responded ${e.statusCode}` };
    }
    // Deliberately not the raw error: it can carry the endpoint, and an endpoint is a per-member secret.
    return { outcome: "failed", status: null, error: e instanceof Error ? e.name : "unknown error" };
  }
}

/** The public half of our VAPID keypair, for a browser about to subscribe. Null when push is not configured. */
export function vapidPublicKey(): string | null {
  return webPushConfigured() ? getEnv().VAPID_PUBLIC_KEY! : null;
}
