/**
 * Onboarding stages, in the prototype's order. Step 1 is authentication ("Continue with Google", replacing the
 * prototype's phone + code screens) and shares the same "n / 11" progress treatment; the done screen is 11.
 */
export const ONBOARDING_STAGES = ["NAME", "DOB", "GENDER", "MEET", "INTENT", "LOCATION", "PHOTOS", "ABOUT", "PRIVACY"] as const;
export type OnboardingStageKey = (typeof ONBOARDING_STAGES)[number];
export type StageOrComplete = OnboardingStageKey | "COMPLETE";

export const TOTAL_STEPS = 11;
export const AUTH_STEPS = { GOOGLE: 1 } as const;

export interface StageMeta {
  key: OnboardingStageKey;
  slug: string;
  step: number;
  title: string | ((name: string) => string);
  subtitle: string;
  cta: string;
}

export const STAGE_META: Record<OnboardingStageKey, StageMeta> = {
  NAME: { key: "NAME", slug: "name", step: 2, title: "What's your name?", subtitle: "The name people will see.", cta: "Continue" },
  DOB: { key: "DOB", slug: "birthday", step: 3, title: "When's your birthday?", subtitle: "Only your age is shown.", cta: "Continue" },
  GENDER: { key: "GENDER", slug: "gender", step: 4, title: "How do you identify?", subtitle: "", cta: "Continue" },
  MEET: { key: "MEET", slug: "meet", step: 5, title: "Who would you like to meet?", subtitle: "You can change this any time.", cta: "Continue" },
  INTENT: { key: "INTENT", slug: "intention", step: 6, title: "What are you looking for?", subtitle: "Helps us show people who want the same thing.", cta: "Continue" },
  LOCATION: { key: "LOCATION", slug: "location", step: 7, title: "Where are you based?", subtitle: "Choose your island or atoll — never an exact location.", cta: "Continue" },
  PHOTOS: { key: "PHOTOS", slug: "photos", step: 8, title: "Add your photos", subtitle: "Up to 6. Drag to reorder later.", cta: "Continue" },
  ABOUT: { key: "ABOUT", slug: "about", step: 9, title: "About you", subtitle: "A little about you, and what you enjoy.", cta: "Continue" },
  PRIVACY: { key: "PRIVACY", slug: "privacy", step: 10, title: "Privacy first", subtitle: "Set up how private you want to be before anyone sees you.", cta: "Continue" },
};

export const DONE_META = { slug: "done", step: 11, title: (name: string) => `You're ready, ${name || "there"}.`, subtitle: "", cta: "Start discovering" } as const;

export function stageIndex(stage: StageOrComplete): number {
  return stage === "COMPLETE" ? ONBOARDING_STAGES.length : ONBOARDING_STAGES.indexOf(stage);
}

export function nextStage(stage: OnboardingStageKey): StageOrComplete {
  const i = ONBOARDING_STAGES.indexOf(stage);
  return ONBOARDING_STAGES[i + 1] ?? "COMPLETE";
}

export function previousStage(stage: OnboardingStageKey): OnboardingStageKey | null {
  const i = ONBOARDING_STAGES.indexOf(stage);
  return i > 0 ? ONBOARDING_STAGES[i - 1]! : null;
}

export function stageFromSlug(slug: string): OnboardingStageKey | "DONE" | null {
  if (slug === DONE_META.slug) return "DONE";
  const found = ONBOARDING_STAGES.find((s) => STAGE_META[s].slug === slug);
  return found ?? null;
}

export function slugForStage(stage: StageOrComplete): string {
  return stage === "COMPLETE" ? DONE_META.slug : STAGE_META[stage].slug;
}

/** The furthest stage a user may open. A stage beyond the pointer redirects here. */
export function resumeSlug(pointer: StageOrComplete): string {
  return slugForStage(pointer);
}

/** Has the user reached (saved through) `stage`? */
export function hasReached(pointer: StageOrComplete, stage: OnboardingStageKey): boolean {
  return stageIndex(pointer) >= stageIndex(stage);
}
