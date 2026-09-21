/**
 * The contract between the website and the MelloCrush Android shell (docs/ARCHITECTURE.md §4.1c).
 *
 * Both halves read these constants: the web app to decide whether it is running inside the shell and where to
 * send the browser back to, and `mobile/capacitor.config.ts` plus the Android manifest to declare the same
 * user-agent suffix and the same custom scheme. They are here, in one importable file, because a mismatch
 * between the two would not fail a build — it would silently strand every Android sign-in in a browser tab.
 *
 * Nothing here is a secret. The suffix is an advertisement and the scheme is public by construction; neither
 * grants anything. Authority comes from the handoff code and its verifier (src/server/auth/handoff.ts).
 */

/** Appended to the WebView's user agent by `appendUserAgent` in mobile/capacitor.config.ts. */
export const NATIVE_UA_SUFFIX = "MelloCrushAndroid";

/** The Android application id, which doubles as the custom scheme the deep link uses. */
export const NATIVE_APP_ID = "com.mellocrush.app";

/** Where the OAuth browser tab is sent once the server has a handoff code for it. */
export const NATIVE_AUTH_DEEP_LINK = `${NATIVE_APP_ID}://auth/callback`;

/** The query parameter the app adds to `/auth/<provider>/start` to ask for the handoff instead of a cookie. */
export const NATIVE_CLIENT_PARAM = "client";
export const NATIVE_CLIENT_VALUE = "android";

/**
 * True when this code is running inside the Android shell's WebView.
 *
 * Deliberately a user-agent test rather than a `window.Capacitor` test. The suffix is set by our own Capacitor
 * config, so it is as trustworthy as the bundle it ships in, and unlike the injected global it is also visible to
 * the server on the very first request — which is what lets a page render the right sign-in buttons without a
 * flash of the wrong ones. A visitor who forges the suffix in a desktop browser gains nothing: the handoff still
 * requires a verifier that only the app generated.
 */
export function isNativeAndroidUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes(NATIVE_UA_SUFFIX);
}
