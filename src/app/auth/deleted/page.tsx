import Link from "next/link";
import { redirect } from "next/navigation";
import { FreshAccountForm } from "@/components/features/auth/fresh-account-form";
import { Wordmark } from "@/components/brand/logo";
import { readPendingIdentity } from "@/lib/oauth-cookie";
import { redirectIfAuthenticated } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";

export const metadata = { title: "Account deleted" };

/**
 * The Google account that just signed in belongs to a Mellocrush account that was deleted (docs/ARCHITECTURE.md §4.4).
 * Nothing is revived automatically: the person is told, and only an explicit choice creates a brand-new account.
 */
export default async function DeletedAccountPage() {
  await redirectIfAuthenticated();
  const pending = await readPendingIdentity();
  if (!pending) redirect(ROUTES.welcome);
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center bg-background px-5 text-text">
      <div className="flex w-full max-w-[var(--onboarding-max)] flex-col gap-4">
        <div className="flex items-center"><Wordmark height={24} /></div>
        <h1 className="text-h2">Your previous Mellocrush account was deleted</h1>
        <p className="text-body text-text-secondary">
          <span className="font-semibold text-text">{pending.email}</span> was used for a Mellocrush account that has since been deleted. Its profile, photos, matches, chats and posts are gone and can&apos;t be restored.
        </p>
        <p className="text-body text-text-secondary">You can start again with a brand-new account. Nothing from before comes back, and you&apos;ll set up your profile from the beginning.</p>
        <FreshAccountForm />
        <Link href={ROUTES.welcome} className="flex h-11 items-center justify-center text-body-sm font-semibold text-text-secondary">Not now</Link>
      </div>
    </main>
  );
}
