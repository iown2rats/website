import { permanentRedirect } from "next/navigation";
import { ROUTES } from "@/server/auth/route-access";

/** The Privacy Policy moved to /privacy (docs/ARCHITECTURE.md §27); this address redirects permanently. */
export default function LegacyPrivacyPage() {
  permanentRedirect(ROUTES.privacy);
}
