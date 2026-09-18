import { VerificationClient } from "@/components/features/settings/verification-client";
import { PageOverlay } from "@/components/layout/page-overlay";
import { requireActiveUser } from "@/server/auth/current-user";
import { getVerificationState } from "@/server/verification";

export const metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

/** Photo verification (docs/ARCHITECTURE.md §11): state comes from the member's own Verification row on every request. */
export default async function VerificationPage() {
  const actor = await requireActiveUser();
  const state = await getVerificationState(actor, { withSelfie: true });
  return (
    <PageOverlay title="Verification" backHref="/profile">
      <VerificationClient initial={state} />
    </PageOverlay>
  );
}
