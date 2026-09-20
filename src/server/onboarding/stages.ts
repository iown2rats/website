/**
 * Onboarding stages, in the prototype's order. Step 1 is authentication ("Continue with Google" or "Continue with
 * Telegram", replacing the prototype's phone + code screens) and shares the same "n / 11" progress treatment; the
 * done screen is 11.
 *
 * The flow branches once, after GENDER, on the connection intent (src/server/preferences/intent-policy.ts):
 *
 *   … GENDER → CONNECTION → INTENT   → LOCATION …   for Dating     (how serious?)
 *   … GENDER → CONNECTION → MEET     → LOCATION …   for Friendship (who would you like to meet?)
 *
 * Each path asks exactly one of MEET / INTENT, so both are the same length and the count stays 11 — the progress
 * treatment and the animations are untouched. That is also why the step number is computed from the path rather
 * than hard-coded per stage: a skipped stage must not leave a hole in the numbering.
 *
 * Dating never asks who to meet, because for Dating there is one answer and a step with one answer is a step that
 * should not exist.
 */
import type { ConnectionIntent } from "@/server/preferences/intent-policy";

export const ONBOARDING_STAGES = ["NAME", "DOB", "GENDER", "CONNECTION", "MEET", "INTENT", "LOCATION", "PHOTOS", "ABOUT", "PRIVACY"] as const;
export type OnboardingStageKey = (typeof ONBOARDING_STAGES)[number];
export type StageOrComplete = OnboardingStageKey | "COMPLETE";

/** The stage each path skips. Kept as data so `stagesFor` and `nextStage` cannot disagree. */
const SKIPPED: Record<ConnectionIntent, OnboardingStageKey> = { DATING: "MEET", FRIENDSHIP: "INTENT" };

/**
 * The stages this member actually walks. Before they have chosen an intent the Dating path is assumed, which is
 * only ever used for numbering the steps behind them — CONNECTION itself is on both paths.
 */
export function stagesFor(intent: ConnectionIntent | null): readonly OnboardingStageKey[] {
  const skipped = SKIPPED[intent ?? "DATING"];
  return ONBOARDING_STAGES.filter((s) => s !== skipped);
}

export const TOTAL_STEPS = 11;
export const AUTH_STEPS = { GOOGLE: 1 } as const;

export interface StageMeta {
  key: OnboardingStageKey;
  slug: string;
  title: string | ((name: string) => string);
  subtitle: string;
  cta: string;
}

export const STAGE_META: Record<OnboardingStageKey, StageMeta> = {
  NAME: { key: "NAME", slug: "name", title: "What's your name?", subtitle: "The name people will see.", cta: "Continue" },
  DOB: { key: "DOB", slug: "birthday", title: "When's your birthday?", subtitle: "Only your age is shown.", cta: "Continue" },
  GENDER: { key: "GENDER", slug: "gender", title: "How do you identify?", subtitle: "", cta: "Continue" },
  CONNECTION: { key: "CONNECTION", slug: "connection", title: "What brings you here?", subtitle: "You can change this any time.", cta: "Continue" },
  MEET: { key: "MEET", slug: "meet", title: "Who would you like to meet?", subtitle: "You can change this any time.", cta: "Continue" },
  INTENT: { key: "INTENT", slug: "intention", title: "What are you looking for?", subtitle: "Helps us show people who want the same thing.", cta: "Continue" },
  LOCATION: { key: "LOCATION", slug: "location", title: "Where are you based?", subtitle: "Choose your island or atoll — never an exact location.", cta: "Continue" },
  PHOTOS: { key: "PHOTOS", slug: "photos", title: "Add your photos", subtitle: "Up to 6. Drag to reorder later.", cta: "Continue" },
  ABOUT: { key: "ABOUT", slug: "about", title: "About you", subtitle: "A little about you, and what you enjoy.", cta: "Continue" },
  PRIVACY: { key: "PRIVACY", slug: "privacy", title: "Privacy first", subtitle: "Set up how private you want to be before anyone sees you.", cta: "Continue" },
};

export const DONE_META = { slug: "done", step: TOTAL_STEPS, title: (name: string) => `You're ready, ${name || "there"}.`, subtitle: "", cta: "Start discovering" } as const;

/** The "n" in "n / 11" for this stage on this path. Auth is 1, so the first stage is 2. */
export function stepNumber(stage: OnboardingStageKey, intent: ConnectionIntent | null): number {
  const i = stagesFor(intent).indexOf(stage);
  return (i < 0 ? ONBOARDING_STAGES.indexOf(stage) : i) + 2;
}

/**
 * Position in the full stage list, INCLUDING the stage this path skips. `hasReached` compares these, so a member
 * who walked the Dating path still counts as past MEET: the pointer is "how far through onboarding", not "which
 * questions were answered".
 */
export function stageIndex(stage: StageOrComplete): number {
  return stage === "COMPLETE" ? ONBOARDING_STAGES.length : ONBOARDING_STAGES.indexOf(stage);
}

export function nextStage(stage: OnboardingStageKey, intent: ConnectionIntent | null): StageOrComplete {
  const path = stagesFor(intent);
  const i = path.indexOf(stage);
  if (i < 0) return "COMPLETE";
  return path[i + 1] ?? "COMPLETE";
}

export function previousStage(stage: OnboardingStageKey, intent: ConnectionIntent | null): OnboardingStageKey | null {
  const path = stagesFor(intent);
  const i = path.indexOf(stage);
  return i > 0 ? path[i - 1]! : null;
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

/** Is this stage part of the member's path at all? Opening the other path's question is not allowed. */
export function isOnPath(stage: OnboardingStageKey, intent: ConnectionIntent | null): boolean {
  return stagesFor(intent).includes(stage);
}
