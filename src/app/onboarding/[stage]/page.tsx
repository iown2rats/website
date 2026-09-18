import { notFound, redirect } from "next/navigation";
import { AboutForm } from "@/components/features/onboarding/about-form";
import { ChoiceForm } from "@/components/features/onboarding/choice-form";
import { DobForm } from "@/components/features/onboarding/dob-form";
import { DoneStep } from "@/components/features/onboarding/done-step";
import { LocationForm } from "@/components/features/onboarding/location-form";
import { NameForm } from "@/components/features/onboarding/name-form";
import { PhotosForm } from "@/components/features/onboarding/photos-form";
import { PrivacyForm } from "@/components/features/onboarding/privacy-form";
import { StepFrame } from "@/components/features/onboarding/step-frame";
import { submitGender, submitIntent, submitMeet } from "@/actions/onboarding";
import { getDb } from "@/lib/db";
import { pendingPhotosAwaitReview } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import { requireOnboardingUser } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";
import { getOnboardingData } from "@/server/onboarding/onboarding";
import { DONE_META, STAGE_META, hasReached, previousStage, resumeSlug, slugForStage, stageFromSlug, type StageOrComplete } from "@/server/onboarding/stages";
import { listPhotos } from "@/server/photos/photos";
import { GENDER_LABELS, INTENT_LABELS, INTERESTED_IN_LABELS } from "@/constants/labels";

export default async function OnboardingStagePage({ params }: { params: Promise<{ stage: string }> }) {
  const { stage: slug } = await params;
  const stage = stageFromSlug(slug);
  if (!stage) notFound();

  const actor = await requireOnboardingUser();
  const data = await getOnboardingData(actor);
  const pointer = data.stage as StageOrComplete;

  // A stage beyond what the user has reached is not openable: resume where they really are.
  // The done screen opens once the privacy stage has been reached; it re-validates everything on submit.
  const gate = stage === "DONE" ? "PRIVACY" : stage;
  if (!hasReached(pointer, gate)) redirect(`${ROUTES.onboarding}/${resumeSlug(pointer)}`);

  if (stage === "DONE") {
    return (
      <StepFrame step={DONE_META.step} title={DONE_META.title(data.name ?? "")} backHref={`${ROUTES.onboarding}/${STAGE_META.PRIVACY.slug}`}>
        <DoneStep completionPercent={data.completion.percent} missing={data.completion.missingRequired} />
      </StepFrame>
    );
  }

  const meta = STAGE_META[stage];
  const prev = previousStage(stage);
  const backHref = prev ? `${ROUTES.onboarding}/${slugForStage(prev)}` : null;
  const frame = { step: meta.step, title: typeof meta.title === "function" ? meta.title(data.name ?? "") : meta.title, subtitle: meta.subtitle || undefined, backHref };

  switch (stage) {
    case "NAME":
      return <StepFrame {...frame}><NameForm initialName={data.name ?? ""} /></StepFrame>;
    case "DOB":
      return <StepFrame {...frame}><DobForm initial={data.dob} /></StepFrame>;
    case "GENDER":
      return (
        <StepFrame {...frame}>
          <ChoiceForm name="gender" label="Gender" action={submitGender} initial={data.gender} options={Object.entries(GENDER_LABELS).map(([value, label]) => ({ value, label }))} />
        </StepFrame>
      );
    case "MEET":
      return (
        <StepFrame {...frame}>
          <ChoiceForm name="interestedIn" label="Who would you like to meet" action={submitMeet} initial={data.interestedIn} options={Object.entries(INTERESTED_IN_LABELS).map(([value, label]) => ({ value, label }))} />
        </StepFrame>
      );
    case "INTENT":
      return (
        <StepFrame {...frame}>
          <ChoiceForm name="intent" label="Relationship intention" action={submitIntent} initial={data.intent} options={Object.entries(INTENT_LABELS).map(([value, label]) => ({ value, label }))} />
        </StepFrame>
      );
    case "LOCATION": {
      const locations = await getDb().location.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true, atollName: true } });
      return <StepFrame {...frame}><LocationForm locations={locations} initialId={data.locationId} /></StepFrame>;
    }
    case "PHOTOS": {
      const photos = await listPhotos(actor, { storage: getStorageProvider() });
      return <StepFrame {...frame}><PhotosForm initialPhotos={photos} reviewedBeforeVisible={pendingPhotosAwaitReview()} /></StepFrame>;
    }
    case "ABOUT": {
      const db = getDb();
      const [interests, prompts] = await Promise.all([
        db.interest.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
        db.prompt.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, text: true } }),
      ]);
      return <StepFrame {...frame}><AboutForm interests={interests} prompts={prompts} initialBio={data.bio} initialInterestIds={data.interestIds} initialPrompts={data.prompts} /></StepFrame>;
    }
    case "PRIVACY":
      return <StepFrame {...frame}><PrivacyForm initial={data.privacy} /></StepFrame>;
  }
}
