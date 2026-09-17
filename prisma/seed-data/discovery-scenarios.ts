/**
 * DEMO DATA — development only. Discovery scenarios around the prototype's "me" user (Ismail, +9607000010:
 * man, wants women, 22–34, Malé, Free). Each entry exercises one rule of the discovery query so the deck can be
 * checked by eye and by Playwright against real PostgreSQL rows. Never loaded when NODE_ENV=production.
 *
 * Phones use the reserved demo range +96070001xx. Photos are placeholder keys rendered as gradients.
 */
import type { DemoProfile } from "./demo";

export type ScenarioKind =
  | "PLAIN" // eligible, appears
  | "BOOSTED" // eligible, active Plus boost → first
  | "HIDDEN_LOCATION" // eligible; location absent from the card
  | "HIDDEN_AGE" // eligible; age absent from the card
  | "INVISIBLE_LIKED_ME" // Plus + Invisible Mode, has liked me → appears
  | "INVISIBLE_STRANGER" // Plus + Invisible Mode, has not liked me → hidden
  | "INVISIBLE_EXPIRED" // Invisible Mode with lapsed Plus, liked me → still hidden (fail closed)
  | "WANTS_WOMEN" // woman who wants women → incompatible with me
  | "TOO_OLD" // 41, outside my 22–34
  | "DOES_NOT_WANT_MY_AGE" // her range excludes 27
  | "I_BLOCKED" // I blocked her
  | "BLOCKED_ME" // she blocked me
  | "PASSED_RECENTLY" // passed 2 days ago → hidden for 28 more days
  | "PASSED_LONG_AGO" // passed 40 days ago → resurfaced
  | "ALREADY_LIKED" // I liked her already
  | "LIKES_ME" // she liked me; liking back creates a match
  | "SUSPENDED"
  | "ONBOARDING"
  | "ONE_PHOTO"
  | "IN_ADDU"; // eligible; only appears when location filter allows

export interface Scenario {
  kind: ScenarioKind;
  profile: DemoProfile;
}

const base = (key: string, phone: string, name: string, age: number, location: string, extra: Partial<DemoProfile> = {}): DemoProfile => ({
  key,
  phone,
  name,
  gender: "WOMAN",
  interestedIn: "MEN",
  age,
  location,
  occupation: "Teacher",
  education: "MNU",
  languages: ["Dhivehi", "English"],
  heightCm: 160,
  intent: "DATING",
  interests: ["Coffee", "Reading", "Swimming"],
  bio: `Demo profile for the ${key} discovery scenario.`,
  prompt: 0,
  answer: "A slow morning and a fast boat.",
  hues: [180, 200],
  verified: false,
  ...extra,
});

export const DISCOVERY_SCENARIOS: Scenario[] = [
  { kind: "BOOSTED", profile: base("s-boosted", "+9607000101", "Leena", 27, "male", { occupation: "Pilot", hues: [150, 165, 175], verified: true }) },
  { kind: "PLAIN", profile: base("s-plain-1", "+9607000102", "Raufa", 25, "hulhumale", { occupation: "Pharmacist", hues: [190, 210] }) },
  { kind: "PLAIN", profile: base("s-plain-2", "+9607000103", "Shifa", 30, "vilimale", { occupation: "Chef", intent: "SERIOUS_RELATIONSHIP", hues: [170, 185, 199], verified: true }) },
  { kind: "HIDDEN_LOCATION", profile: base("s-hidden-loc", "+9607000104", "Nuha", 26, "male", { occupation: "Lawyer", hues: [205, 176] }) },
  { kind: "HIDDEN_AGE", profile: base("s-hidden-age", "+9607000105", "Sama", 29, "male", { occupation: "Doctor", hues: [160, 195] }) },
  { kind: "INVISIBLE_LIKED_ME", profile: base("s-invis-liked", "+9607000106", "Reesha", 28, "hulhumale", { occupation: "Architect", hues: [212, 188] }) },
  { kind: "INVISIBLE_STRANGER", profile: base("s-invis-stranger", "+9607000107", "Thoola", 27, "male", { hues: [140, 160] }) },
  { kind: "INVISIBLE_EXPIRED", profile: base("s-invis-expired", "+9607000108", "Malsa", 26, "male", { hues: [130, 150] }) },
  { kind: "WANTS_WOMEN", profile: base("s-wants-women", "+9607000109", "Hawwa", 27, "male", { interestedIn: "WOMEN", hues: [120, 140] }) },
  { kind: "TOO_OLD", profile: base("s-too-old", "+9607000110", "Aminath", 41, "male", { hues: [110, 130] }) },
  { kind: "DOES_NOT_WANT_MY_AGE", profile: base("s-not-my-age", "+9607000111", "Dheena", 24, "male", { hues: [100, 120] }) },
  { kind: "I_BLOCKED", profile: base("s-i-blocked", "+9607000112", "Bisma", 26, "male", { hues: [90, 110] }) },
  { kind: "BLOCKED_ME", profile: base("s-blocked-me", "+9607000113", "Rifga", 26, "male", { hues: [80, 100] }) },
  { kind: "PASSED_RECENTLY", profile: base("s-passed-recent", "+9607000114", "Suha", 25, "male", { hues: [70, 90] }) },
  { kind: "PASSED_LONG_AGO", profile: base("s-passed-old", "+9607000115", "Ifa", 27, "hulhumale", { occupation: "Designer", hues: [60, 80] }) },
  { kind: "ALREADY_LIKED", profile: base("s-already-liked", "+9607000116", "Nashwa", 28, "male", { hues: [50, 70] }) },
  { kind: "LIKES_ME", profile: base("s-likes-me", "+9607000117", "Yumna", 27, "male", { occupation: "Marine biologist", hues: [40, 60, 200], verified: true }) },
  { kind: "SUSPENDED", profile: base("s-suspended", "+9607000118", "Zeena", 27, "male", { hues: [30, 50] }) },
  { kind: "ONBOARDING", profile: base("s-onboarding", "+9607000119", "Laila", 27, "male", { hues: [20, 40] }) },
  { kind: "ONE_PHOTO", profile: base("s-one-photo", "+9607000120", "Mira", 27, "male", { hues: [10] }) },
  { kind: "IN_ADDU", profile: base("s-in-addu", "+9607000121", "Shaira", 29, "addu-city", { occupation: "Nurse", hues: [230, 250] }) },
];

/** A second dev login with Plus (Undo, advanced filters, boosts): Ahmed's counterpart "Ismail Plus". */
export const DEMO_PLUS_USER: DemoProfile = {
  key: "plus",
  phone: "+9607000011",
  name: "Yaamin",
  gender: "MAN",
  interestedIn: "WOMEN",
  age: 29,
  location: "hulhumale",
  occupation: "Pilot",
  education: "Villa College",
  languages: ["Dhivehi", "English"],
  heightCm: 180,
  intent: "DATING",
  interests: ["Travel", "Surfing", "Music"],
  bio: "Plus test account. Undo, boosts and advanced filters live here.",
  prompt: 1,
  answer: "Ask me about the ferry timetable.",
  hues: [195, 175],
  verified: true,
};
