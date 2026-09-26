import { redirect } from "next/navigation";
import { requireOnboardingUser } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";
import { getOnboardingData } from "@/server/onboarding/onboarding";
import { resumeSlug } from "@/server/onboarding/stages";

/** /onboarding resumes at the furthest stage the user has reached, on their own path (never a removed question). */
export default async function OnboardingIndex() {
  const actor = await requireOnboardingUser();
  const data = await getOnboardingData(actor);
  redirect(`${ROUTES.onboarding}/${resumeSlug(data.stage, data.connectionIntent)}`);
}
