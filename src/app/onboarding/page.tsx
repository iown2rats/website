import { redirect } from "next/navigation";
import { requireOnboardingUser } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";
import { resumeSlug } from "@/server/onboarding/stages";

/** /onboarding resumes at the furthest stage the user has reached. */
export default async function OnboardingIndex() {
  const { user } = await requireOnboardingUser();
  redirect(`${ROUTES.onboarding}/${resumeSlug(user.onboardingStage as Parameters<typeof resumeSlug>[0])}`);
}
