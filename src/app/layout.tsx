import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { NativeAuthListener } from "@/components/features/auth/native-auth-listener";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Plus Jakarta Sans (OFL), variable weight 200–800, self-hosted so no runtime request leaves the app.
const jakarta = localFont({
  variable: "--font-jakarta",
  display: "swap",
  src: [
    { path: "../fonts/plus-jakarta-sans-latin.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/plus-jakarta-sans-latin-ext.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/plus-jakarta-sans-vietnamese.woff2", weight: "200 800", style: "normal" },
    { path: "../fonts/plus-jakarta-sans-cyrillic-ext.woff2", weight: "200 800", style: "normal" },
  ],
});

const DESCRIPTION = "Meet someone closer to home. Dating for the Maldives. Private by design, 18+ only.";

export const metadata: Metadata = {
  title: { default: "Mellocrush", template: "%s · Mellocrush" },
  description: DESCRIPTION,
  applicationName: "Mellocrush",
  openGraph: { title: "Mellocrush", siteName: "Mellocrush", description: DESCRIPTION, type: "website" },
  twitter: { card: "summary", title: "Mellocrush", description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFBF1",
};

/*
 * Two things that must be settled before the first paint.
 *
 * THEME: applies the stored appearance so there is no flash. Per-viewer convenience only.
 *
 * NATIVE: marks the document when it is being rendered inside the Android shell's WebView, which the stylesheet
 * uses to drop `backdrop-filter` (docs/ARCHITECTURE.md §28). The blurs are a genuine hazard there and only there:
 * the signed-out screen alone stacks five of them over a full-bleed cover photograph, and each one forces a
 * composited layer that has to snapshot the whole photograph behind it. Android's WebView renderer does not
 * survive that on every device — it paints once and is killed — while Chrome on the same phone, with its own
 * process and GPU path, is untroubled. It is set here rather than from the user agent on the server because the
 * attribute must exist before the first style is applied, and a browser never sets it at all.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('thundi.theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute('content','#000000');}}}catch(e){}try{if(navigator.userAgent.indexOf('MelloCrushAndroid')!==-1){document.documentElement.setAttribute('data-native','android');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        {/* Inert on the website: one user-agent test in an effect. Inside the Android shell it is what hears the
            browser come back from Google or Telegram, wherever the user happens to be (ARCHITECTURE §4.1c). */}
        <NativeAuthListener />
      </body>
    </html>
  );
}
