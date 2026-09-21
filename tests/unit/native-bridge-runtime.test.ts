import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenForAuthDeepLink, startNativeSignIn } from "@/components/features/auth/native-bridge";

/*
 * The shape of Capacitor's runtime bridge, as the Android shell actually injects it.
 *
 * These tests exist because of a production failure that cost a night. `listenForAuthDeepLink` called `.then()`
 * on the result of `App.addListener`, on the strength of a TYPE THIS REPOSITORY WROTE ITSELF. TypeScript had
 * nothing to check that claim against — the website deliberately does not depend on `@capacitor/app`, because
 * reaching the plugins through `window.Capacitor.Plugins` keeps those packages out of every browser visitor's
 * bundle — so the compiler believed the declaration and the assertion was never tested.
 *
 * On the device it threw `TypeError: …addListener(...).then is not a function` on every page load. The listener
 * is mounted in the ROOT LAYOUT, so that throw took down every screen, React tore the tree down and rebuilt it,
 * and the app reloaded itself roughly once a second for ever.
 *
 * The truth, read from the file Capacitor injects into the page
 * (@capacitor/android/capacitor/src/main/assets/native-bridge.js):
 *
 *   :183  cap.addListener = (pluginName, eventName, callback) => {
 *           const callbackId = cap.nativeCallback(...);
 *           return { remove: async () => { ... } };        // SYNCHRONOUS. No `then`.
 *         };
 *   :999  cap.nativePromise = (pluginName, methodName, options) => new Promise(...)
 *
 * Capacitor's own code inside that same file proves the asymmetry both ways: it calls
 * `cap.Plugins.App.addListener('backButton', …)` with no await at :280, and
 * `Plugins?.WebView?.getServerBasePath().then(…)` at :296. Listeners are synchronous; every other plugin method
 * is a promise.
 *
 * So the fake below is not a convenient mock. It is that contract, and any change to these return shapes should
 * fail here rather than on someone's phone.
 */
function injectedAndroidBridge() {
  const listeners: { event: string; handler: (data: { url: string }) => void }[] = [];
  const opened: string[] = [];
  const removed: string[] = [];
  let closes = 0;

  const bridge = {
    isNativePlatform: () => true,
    Plugins: {
      App: {
        // native-bridge.js:183 — the handle is returned directly, not wrapped in a promise.
        addListener: (event: string, handler: (data: { url: string }) => void) => {
          listeners.push({ event, handler });
          return {
            remove: async () => {
              removed.push(event);
            },
          };
        },
      },
      Browser: {
        // Ordinary plugin methods go through cap.nativePromise and DO return promises.
        open: async ({ url }: { url: string }) => void opened.push(url),
        close: async () => void (closes += 1),
      },
    },
  };

  return { bridge, listeners, opened, removed, closes: () => closes };
}

let replaced: string[] = [];

function installShell(bridge: unknown) {
  replaced = [];
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla/5.0 (Linux; Android 16; A065) AppleWebKit/537.36 MelloCrushAndroid" },
    configurable: true,
    writable: true,
  });
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    Capacitor: bridge,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    window: {
      location: {
        origin: "https://www.mellocrush.com",
        replace: (url: string) => void replaced.push(url),
      },
    },
  });
}

beforeEach(() => installShell(injectedAndroidBridge().bridge));

afterEach(() => {
  for (const key of ["Capacitor", "localStorage", "window"]) delete (globalThis as Record<string, unknown>)[key];
});

describe("listenForAuthDeepLink against the injected Android bridge", () => {
  it("does not throw when addListener returns its handle synchronously", () => {
    // THE REGRESSION. Against the implementation that shipped, this throws
    // "addListener(...).then is not a function" — the error that reloaded the app once a second.
    const shell = injectedAndroidBridge();
    installShell(shell.bridge);
    expect(() => listenForAuthDeepLink()).not.toThrow();
    expect(shell.listeners.map((l) => l.event)).toEqual(["appUrlOpen"]);
  });

  it("still routes a real deep link to the redemption URL", () => {
    const shell = injectedAndroidBridge();
    installShell(shell.bridge);
    const verifier = "v".repeat(43);
    (globalThis as { localStorage: Storage }).localStorage.setItem(
      "mellocrush.handoff.verifier",
      JSON.stringify({ verifier, issuedAt: Date.now() }),
    );

    listenForAuthDeepLink();
    shell.listeners[0]!.handler({ url: "com.mellocrush.app://auth/callback?code=abc123" });

    expect(replaced).toEqual([`/auth/handoff?code=abc123&verifier=${verifier}`]);
  });

  it("returns a cleanup that removes the listener without throwing", () => {
    const shell = injectedAndroidBridge();
    installShell(shell.bridge);
    const stop = listenForAuthDeepLink();
    expect(() => stop()).not.toThrow();
    expect(shell.removed).toEqual(["appUrlOpen"]);
  });

  /*
   * The root layout must survive a bridge that is not the shape we expect. This is the lesson of the outage
   * generalised: one wrong assumption about a runtime we do not control should cost the deep link, never the
   * whole application.
   */
  it("survives every hostile bridge shape, because the root layout mounts this", () => {
    const shapes: Record<string, unknown> = {
      "addListener throws": { isNativePlatform: () => true, Plugins: { App: { addListener: () => { throw new Error("native boom"); } } } },
      "addListener returns undefined": { isNativePlatform: () => true, Plugins: { App: { addListener: () => undefined } } },
      "handle has no remove": { isNativePlatform: () => true, Plugins: { App: { addListener: () => ({}) } } },
      "handle is a promise (older Capacitor)": {
        isNativePlatform: () => true,
        Plugins: { App: { addListener: () => Promise.resolve({ remove: () => undefined }) } },
      },
      "App plugin missing": { isNativePlatform: () => true, Plugins: {} },
      "Plugins missing": { isNativePlatform: () => true },
      "no bridge at all": undefined,
    };

    for (const [name, shape] of Object.entries(shapes)) {
      installShell(shape);
      expect(() => listenForAuthDeepLink()(), name).not.toThrow();
    }
  });
});

describe("startNativeSignIn against the injected Android bridge", () => {
  it("opens the Custom Tab with the handoff parameters", async () => {
    const shell = injectedAndroidBridge();
    installShell(shell.bridge);

    await expect(startNativeSignIn("/auth/google/start")).resolves.toBe(true);

    expect(shell.opened).toHaveLength(1);
    const url = new URL(shell.opened[0]!);
    expect(url.origin + url.pathname).toBe("https://www.mellocrush.com/auth/google/start");
    expect(url.searchParams.get("client")).toBe("android");
    // The challenge travels; the verifier never does.
    expect(url.searchParams.get("challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(shell.opened[0]).not.toContain(JSON.parse((globalThis as { localStorage: Storage }).localStorage.getItem("mellocrush.handoff.verifier")!).verifier);
  });

  it("reports failure rather than throwing when the browser plugin misbehaves", async () => {
    for (const plugins of [
      { Browser: { open: async () => { throw new Error("no browser"); } } },
      { Browser: {} },
      {},
    ]) {
      installShell({ isNativePlatform: () => true, Plugins: plugins });
      // A caller that gets `false` falls back to the ordinary link; one that gets an exception takes the page
      // down with it, which is the failure this whole file exists to prevent.
      await expect(startNativeSignIn("/auth/google/start")).resolves.toBe(false);
    }
  });
});

describe("outside the shell", () => {
  it("does nothing at all in a browser", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Safari/604.1" },
      configurable: true,
      writable: true,
    });
    delete (globalThis as Record<string, unknown>).Capacitor;
    const stop = listenForAuthDeepLink();
    expect(() => stop()).not.toThrow();
    return expect(startNativeSignIn("/auth/google/start")).resolves.toBe(false);
  });
});

// Keeps `vi` imported for the shared setup file's expectations without stubbing anything here.
afterEach(() => vi.restoreAllMocks());
