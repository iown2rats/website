import { permanentRedirect } from "next/navigation";
import { ROUTES } from "@/server/auth/route-access";

/**
 * The Terms moved to /terms when the real document was published (docs/ARCHITECTURE.md §27). This kept address
 * redirects permanently, because it is already linked from sign-in screens people may have bookmarked.
 */
export default function LegacyTermsPage() {
  permanentRedirect(ROUTES.terms);
}
