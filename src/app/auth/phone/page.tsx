import { PhoneForm } from "@/components/features/auth/phone-form";
import { StepFrame } from "@/components/features/onboarding/step-frame";
import { readOtpChallengeCookie } from "@/lib/otp-cookie";
import { AUTH_STEPS } from "@/server/onboarding/stages";

export const metadata = { title: "Your number" };

export default async function PhonePage() {
  // Coming back from the code screen ("Use a different number" / "Request a new code") keeps the number filled in.
  const challenge = await readOtpChallengeCookie();
  return (
    <StepFrame step={AUTH_STEPS.PHONE} title="What's your number?" subtitle="We'll text you a code. Maldivian numbers only." backHref="/">
      <PhoneForm initialPhone={challenge?.phoneLocal ?? ""} />
    </StepFrame>
  );
}
