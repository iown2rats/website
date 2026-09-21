"use client";

import { NATIVE_APP_ID, NATIVE_CLIENT_PARAM, NATIVE_CLIENT_VALUE, isNativeAndroidUserAgent } from "@/lib/native-app";

/**
 * The browser half of the Android sign-in handoff (docs/ARCHITECTURE.md §4.1c).
 *
 * This file runs in two places that look identical and are not: an ordinary phone browser, where every function
 * below is inert, and the shell app's WebView, where they drive a Chrome Custom Tab. Everything is guarded by
 * `isNativeApp()` and by optional chaining into the Capacitor bridge, so a normal visitor executes a user-agent
 * test and nothing else.
 *
 * The Capacitor plugins are reached through the `window.Capacitor.Plugins` proxy rather than by importing
 * `@capacitor/browser` and `@capacitor/app`. That is deliberate: those packages would be dependencies of the
 * WEBSITE, shipped to every visitor on every platform, to call something only one build can answer. The proxy is
 * already in the WebView because the native plugins are registered there.
 */

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: {
    Browser?: { open: (options: { url: string }) => Promise<void>; close?: () => Promise<void> };
    App?: { addListener: (event: string, handler: (data: { url: string }) => void) => Promise<{ remove: () => void }> };
  };
}

const bridge = (): CapacitorBridge | undefined => (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;

/*
 * Where the verifier waits while the user is away in the browser.
 *
 * localStorage, NOT sessionStorage, and that distinction is the whole reason this comment exists. While the user
 * is in the Custom Tab, MelloCrush is a backgrounded Android app and the system may reclaim its process at any
 * time. The deep link still arrives — Capacitor replays it, because BridgeActivity.load() feeds the launching
 * intent through onNewIntent() and appUrlOpen is notified with retainUntilConsumed, so a listener that registers
 * afterwards still receives it — but the WebView is a NEW one, and sessionStorage belongs to the WebView that
 * died. The verifier would be gone and every reclaimed sign-in would end on the error screen.
 *
 * The cost of the durable store is bounded: the value is useless without a code that lives two minutes, it is
 * deleted the moment it is read, and it is discarded on sight once it is older than one OAuth round trip.
 */
const VERIFIER_KEY = "mellocrush.handoff.verifier";
/**
 * How long a stored verifier stays usable. The pending-auth cookie gives the OAuth round trip ten minutes and the
 * handoff code two more, so fifteen covers the longest legitimate journey with room for a slow sign-in, and
 * anything older is the debris of an attempt that was abandoned.
 */
const VERIFIER_TTL_MS = 15 * 60_000;

export function isNativeApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return isNativeAndroidUserAgent(navigator.userAgent) || bridge()?.isNativePlatform?.() === true;
}

const toBase64Url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * A fresh verifier and its challenge. 32 bytes from the platform CSPRNG; the verifier stays on the device and the
 * challenge is all the server ever sees until redemption.
 */
async function createHandoffPair(): Promise<{ verifier: string; challenge: string }> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const verifier = toBase64Url(raw);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(digest) };
}

/** The stored shape. The timestamp is what lets a stale verifier be recognised rather than tried and refused. */
interface StoredVerifier {
  verifier: string;
  issuedAt: number;
}

/**
 * Reads and clears the stored verifier, or returns null. Exported for its own test: "does this survive the app
 * being killed" is not a question a browser test can ask, so the storage contract is tested directly instead.
 */
export function takeStoredVerifier(store: Pick<Storage, "getItem" | "removeItem">, now = Date.now()): string | null {
  let raw: string | null;
  try {
    raw = store.getItem(VERIFIER_KEY);
    store.removeItem(VERIFIER_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredVerifier>;
    if (typeof parsed.verifier !== "string" || typeof parsed.issuedAt !== "number") return null;
    if (now - parsed.issuedAt > VERIFIER_TTL_MS || now < parsed.issuedAt) return null;
    return parsed.verifier;
  } catch {
    return null;
  }
}

/**
 * Starts a provider sign-in from inside the app: mint the pair, keep the verifier, and hand the browser a start
 * URL that asks for the handoff. Returns false when this is not the app, so the caller can let its ordinary link
 * proceed — that is the path every website visitor takes.
 */
export async function startNativeSignIn(startPath: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  const { verifier, challenge } = await createHandoffPair();
  try {
    // Last write wins. A second tap supersedes the first here and at the server, where the new start overwrites
    // the pending-auth cookie, so the newest attempt is the one that can complete and an abandoned one expires.
    localStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, issuedAt: Date.now() } satisfies StoredVerifier));
  } catch {
    // Blocked or full storage: without somewhere durable to keep the verifier the handoff cannot be completed,
    // and falling through to the WebView would only reach Google's "disallowed_useragent" screen.
    return false;
  }
  const url = new URL(startPath, window.location.origin);
  url.searchParams.set(NATIVE_CLIENT_PARAM, NATIVE_CLIENT_VALUE);
  url.searchParams.set("challenge", challenge);
  const browser = bridge()?.Plugins?.Browser;
  if (!browser) return false;
  await browser.open({ url: url.toString() });
  return true;
}

/** Consumes the stored verifier. One read: a second attempt with the same one is meaningless anyway. */
function takeVerifier(): string | null {
  try {
    return takeStoredVerifier(localStorage);
  } catch {
    return null;
  }
}

/**
 * Turns `com.mellocrush.app://auth/callback?...` into the same-origin URL the WebView should go to next: the
 * redemption endpoint on success, the ordinary error screen otherwise. Exported for its own unit test — the deep
 * link is the one input here that arrives from outside the app.
 */
export function resolveDeepLink(rawUrl: string, verifier: string | null): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${NATIVE_APP_ID}:` || url.host !== "auth") return null;

  const error = url.searchParams.get("error");
  if (error) {
    const provider = url.searchParams.get("provider");
    return `/auth/error?reason=${encodeURIComponent(error)}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`;
  }
  const code = url.searchParams.get("code");
  if (!code || !verifier) return "/auth/error?reason=handoff";
  return `/auth/handoff?code=${encodeURIComponent(code)}&verifier=${encodeURIComponent(verifier)}`;
}

/**
 * Listens for the deep link that means the browser is done. Closes the Custom Tab, then navigates the WebView to
 * the resolved URL with `location.replace`, so the redemption URL — which carries the verifier — does not become
 * a history entry the back button can return to.
 */
export function listenForAuthDeepLink(): () => void {
  if (!isNativeApp()) return () => {};
  let remove: (() => void) | undefined;
  void bridge()
    ?.Plugins?.App?.addListener("appUrlOpen", (data) => {
      const next = resolveDeepLink(data?.url ?? "", takeVerifier());
      if (!next) return;
      void bridge()?.Plugins?.Browser?.close?.().catch(() => undefined);
      window.location.replace(next);
    })
    .then((handle) => {
      remove = handle.remove;
    })
    .catch(() => undefined);
  return () => remove?.();
}
