import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AnalyticsTracker } from "@/components/features/analytics/tracker";
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

// Applies the stored appearance before first paint to avoid a theme flash. Per-viewer convenience only.
const themeInit = `(function(){try{var t=localStorage.getItem('thundi.theme');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute('content','#000000');}}}catch(e){}})();`;

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
        {/* One fire-and-forget beacon per navigation (ARCHITECTURE §30.4). Renders nothing and blocks nothing. */}
        <AnalyticsTracker />
        {/* Vercel Speed Insights: real-user Core Web Vitals, collected by a small script Vercel serves from
            /_vercel/speed-insights (loaded after the page, never blocking it). Reports only on production. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
