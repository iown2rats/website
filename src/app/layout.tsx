import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Thundi", description: "Meet someone closer to home. Dating for the Maldives." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
