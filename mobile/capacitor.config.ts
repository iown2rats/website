import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The MelloCrush Android shell (docs/ARCHITECTURE.md §28).
 *
 * This app has no web assets of its own worth speaking of. The MelloCrush web application cannot be statically
 * exported — 48 of its 57 pages render per request, it has middleware, sixteen route handlers, fourteen server
 * action modules and a Postgres database behind them — so the shell points its WebView at the live site and the
 * existing backend serves it exactly as it serves a phone browser. `www/` holds only the page shown if that
 * navigation cannot happen at all.
 *
 * Two values here are a contract with the website and must match src/lib/native-app.ts:
 *   - `appendUserAgent` is how the web app knows it is inside the shell and must run sign-in through a Custom Tab.
 *   - `appId` doubles as the custom scheme for the OAuth deep link (com.mellocrush.app://auth/callback).
 */
const config: CapacitorConfig = {
  appId: "com.mellocrush.app",
  appName: "MelloCrush",
  webDir: "www",
  android: {
    // No cleartext, anywhere. The app talks to one origin and that origin is HTTPS.
    allowMixedContent: false,
    // A debug build is inspectable by anyone who installs it; that is acceptable for private testing and is the
    // reason this build is never handed to anyone outside it.
    webContentsDebuggingEnabled: true,
  },
  server: {
    // The whole architecture in one line: the shell is a window onto the existing production application, not a
    // second copy of it. There is no second backend and no second database.
    url: "https://www.mellocrush.com",
    androidScheme: "https",
    cleartext: false,
    /*
     * Everything the WebView itself may navigate to. Anything else — a link someone posts, a redirect off the
     * site — is handed to the system browser instead of being allowed to live inside the app wearing its chrome.
     *
     * Supabase is here because member photos, receipts and verification selfies are served from signed URLs on
     * the project's storage host; without it every image in the app would fail to load.
     */
    allowNavigation: ["www.mellocrush.com", "mellocrush.com", "qkubuaicuyoaskzcabcu.supabase.co"],
  },
  // Must equal NATIVE_UA_SUFFIX in src/lib/native-app.ts.
  appendUserAgent: "MelloCrushAndroid",
};

export default config;
