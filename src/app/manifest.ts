import type { MetadataRoute } from "next";
import icon192 from "@/assets/brand/mellocrush-app-icon-192.png";
import icon512 from "@/assets/brand/mellocrush-app-icon-512.png";

/**
 * Web app manifest: the brand name and the icon-only mark (the interlocking "oo" with the heart) on the warm page
 * colour. The icons are imported so their URLs carry a content hash — a home-screen icon is installed once and kept,
 * so a fixed path would pin whichever artwork was current on the day someone added the app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mellocrush",
    short_name: "Mellocrush",
    description: "Meet someone closer to home. Dating for the Maldives. Private by design, 18+ only.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFBF1",
    theme_color: "#FFFBF1",
    icons: [
      { src: icon192.src, sizes: "192x192", type: "image/png" },
      { src: icon512.src, sizes: "512x512", type: "image/png" },
    ],
  };
}
