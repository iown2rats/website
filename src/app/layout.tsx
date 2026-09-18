import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
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

export const metadata: Metadata = {
  title: { default: "Thundi", template: "%s · Thundi" },
  description: "Meet someone closer to home. Dating for the Maldives. Private by design, 18+ only.",
  applicationName: "Thundi",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FCEDEA" },
    { media: "(prefers-color-scheme: dark)", color: "#32232A" },
  ],
};

// Applies the stored appearance before first paint to avoid a theme flash. Per-viewer convenience only.
const themeInit = `(function(){try{var t=localStorage.getItem('thundi.theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
