import type { MetadataRoute } from "next";

/** Web app manifest: the brand name and the icon-only mark (linked "oo" + star) on the warm page colour. */
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
      { src: "/brand/mellocrush-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/mellocrush-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
