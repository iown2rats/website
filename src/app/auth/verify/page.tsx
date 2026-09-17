import { redirect } from "next/navigation";
import { OtpForm } from "@/components/features/auth/otp-form";
import { StepFrame } from "@/components/features/onboarding/step-frame";
import { isChallengeExpired, readOtpChallengeCookie } from "@/lib/otp-cookie";
import { ROUTES } from "@/server/auth/route-access";
import { AUTH_STEPS } from "@/server/onboarding/stages";

export const metadata = { title: "Enter the code" };

export default async function VerifyPage() {
  const challenge = await readOtpChallengeCookie();
  if (!challenge) redirect(ROUTES.phone);
  return (
    <StepFrame step={AUTH_STEPS.OTP} title="Enter the code" subtitle="A 6-digit code was sent by SMS." backHref={ROUTES.phone}>
      <OtpForm
        phoneLocal={challenge.phoneLocal}
        resendAvailableAt={challenge.resendAvailableAt}
        devCode={challenge.devCode}
        initialExpired={isChallengeExpired(challenge)}
      />
    </StepFrame>
  );
}
