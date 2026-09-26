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
import { submitConnectionIntent, submitGender, submitIntent } from "@/actions/onboarding";
import { getDb } from "@/lib/db";
import { pendingPhotosAwaitReview } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import { requireOnboardingUser } from "@/server/auth/current-user";
import { ROUTES } from "@/server/auth/route-access";
import { getOnboardingData } from "@/server/onboarding/onboarding";
import { DONE_META, STAGE_META, hasReached, isOnPath, previousStage, resumeSlug, slugForStage, stageFromSlug, stepNumber, totalSteps, type StageOrComplete } from "@/server/onboarding/stages";
import { listPhotos } from "@/server/photos/photos";
import { canDate, DATING_NEEDS_GENDER, selectableGenders } from "@/server/preferences/intent-policy";
import { CONNECTION_INTENT_LABELS, GENDER_LABELS, INTENT_LABELS } from "@/constants/labels";

export default async function OnboardingStagePage({ params }: { params: Promise<{ stage: string }> }) {
  const { stage: slug } = await params;
  const stage = stageFromSlug(slug);
  if (!stage) notFound();

  const actor = await requireOnboardingUser();
  const data = await getOnboardingData(actor);
  // Already the effective pointer: a stored stage that is off this member's path (MEET) reads as the next real one.
  const pointer = data.stage as StageOrComplete;
  const total = totalSteps(data.connectionIntent);

  // A stage beyond what the user has reached is not openable: resume where they really are.
  // The done screen opens once the privacy stage has been reached; it re-validates everything on submit.
  const gate = stage === "DONE" ? "PRIVACY" : stage;
  if (!hasReached(pointer, gate)) redirect(`${ROUTES.onboarding}/${resumeSlug(pointer, data.connectionIntent)}`);
  // A question that is not on this member's path is not theirs to answer: nobody is asked "who would you like to
  // meet" any more, and Friendship is not asked how serious it is. Opening one by URL resumes where they really are.
  if (stage !== "DONE" && !isOnPath(stage, data.connectionIntent)) redirect(`${ROUTES.onboarding}/${resumeSlug(pointer, data.connectionIntent)}`);

  if (stage === "DONE") {
    return (
      <StepFrame step={total} total={total} title={DONE_META.title(data.name ?? "")} backHref={`${ROUTES.onboarding}/${STAGE_META.PRIVACY.slug}`}>
        <DoneStep completionPercent={data.completion.percent} missing={data.completion.missingRequired} />
      </StepFrame>
    );
  }

  const meta = STAGE_META[stage];
  const prev = previousStage(stage, data.connectionIntent);
  const backHref = prev ? `${ROUTES.onboarding}/${slugForStage(prev)}` : null;
  const frame = { step: stepNumber(stage, data.connectionIntent), total, title: typeof meta.title === "function" ? meta.title(data.name ?? "") : meta.title, subtitle: meta.subtitle || undefined, backHref };

  switch (stage) {
    case "NAME":
      return <StepFrame {...frame}><NameForm initialName={data.name ?? ""} /></StepFrame>;
    case "DOB":
      return <StepFrame {...frame}><DobForm initial={data.dob} /></StepFrame>;
    case "GENDER":
      return (
        <StepFrame {...frame}>
          {/* Woman or Man. "Prefer not to say" is offered only to somebody who already holds it, so it is never taken away. */}
          <ChoiceForm name="gender" label="Gender" action={submitGender} initial={data.gender} options={selectableGenders(data.gender).map((value) => ({ value, label: GENDER_LABELS[value] }))} />
        </StepFrame>
      );
    case "CONNECTION":
      return (
        <StepFrame {...frame}>
          {/* Dating is woman ↔ man, so "Prefer not to say" is shown why instead of being let into a Dating state that can never match. */}
          <ChoiceForm
            name="connectionIntent"
            label="What brings you here"
            action={submitConnectionIntent}
            initial={data.connectionIntent}
            options={Object.entries(CONNECTION_INTENT_LABELS).map(([value, label]) => (value === "DATING" && !canDate(data.gender) ? { value, label, disabled: true, description: DATING_NEEDS_GENDER } : { value, label }))}
          />
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
