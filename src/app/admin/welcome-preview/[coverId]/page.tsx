import { AuthShell } from "@/components/features/auth/auth-shell";
import { WelcomeCard } from "@/components/features/auth/welcome-card";
import { getDb } from "@/lib/db";
import { requireAdminPage } from "@/server/admin/authz";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { telegramSignInAvailable } from "@/server/auth/telegram-availability";
import { getWelcomeCover } from "@/server/welcome/admin-covers";

export const metadata = { title: "Cover preview · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The REAL Welcome Screen over a candidate cover (docs/ARCHITECTURE.md §26), rendered on its own so the admin
 * screen can put it in an iframe at a device's dimensions.
 *
 * An iframe rather than a scaled screenshot because an iframe HAS a viewport: at 390 px wide the `<picture>` media
 * queries resolve exactly as they would on a phone, so the preview proves the art direction rather than asserting
 * it. The card is `WelcomeCard`, the same component the live page renders — a preview with its own copy of the
 * card is a preview that quietly stops being true.
 *
 * Admin-only, and noindex: it can show DRAFT artwork, which by definition is not public yet.
 */
export default async function WelcomeCoverPreviewPage({ params }: { params: Promise<{ coverId: string }> }) {
  await requireAdminPage("welcome-cover.manage");
  const { coverId } = await params;
  const db = getDb();
  const [cover, telegram, emailAuth] = await Promise.all([getWelcomeCover(coverId, { db }), telegramSignInAvailable(db), emailAuthAvailable(db)]);
  return (
    <AuthShell cover={cover.preview} labelledBy="welcome-title">
      <WelcomeCard telegram={telegram} emailAuth={emailAuth} />
    </AuthShell>
  );
}
