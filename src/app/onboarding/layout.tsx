import type { ReactNode } from "react";
import { requireOnboardingUser } from "@/server/auth/current-user";

/** Onboarding is only for signed-in users who haven't finished; completed users go to Discover. */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await requireOnboardingUser();
  return <>{children}</>;
}
