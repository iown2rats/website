"use client";

import { useEffect } from "react";
import { listenForAuthDeepLink } from "./native-bridge";

/**
 * Mounted once in the root layout so the app is listening wherever the user happens to be when the browser
 * finishes (docs/ARCHITECTURE.md §4.1c). Renders nothing, and on the website the effect returns immediately
 * after one user-agent test — `listenForAuthDeepLink` is a no-op outside the shell.
 */
export function NativeAuthListener() {
  useEffect(() => listenForAuthDeepLink(), []);
  return null;
}
