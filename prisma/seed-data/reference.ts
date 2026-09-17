/**
 * Reference data (safe for every environment): locations, interests, prompts, plans.
 * Derived from prototype/thundi-data.js.
 */
import { PLAN_CATALOG } from "../../src/config/product";

export interface LocationSeed {
  slug: string;
  name: string;
  kind: "CITY" | "ISLAND" | "ATOLL";
  atollCode: string;
  atollName: string;
  isGreaterMale?: boolean;
  sortOrder: number;
}

const ATOLLS: [code: string, name: string][] = [
  ["HA", "Haa Alif"],
  ["HDh", "Haa Dhaalu"],
  ["Sh", "Shaviyani"],
  ["N", "Noonu"],
  ["R", "Raa"],
  ["B", "Baa"],
  ["Lh", "Lhaviyani"],
  ["K", "Kaafu"],
  ["AA", "Alif Alif"],
  ["ADh", "Alif Dhaal"],
  ["V", "Vaavu"],
  ["M", "Meemu"],
  ["F", "Faafu"],
  ["Dh", "Dhaalu"],
  ["Th", "Thaa"],
  ["L", "Laamu"],
  ["GA", "Gaafu Alif"],
  ["GDh", "Gaafu Dhaalu"],
  // Not in the prototype's atoll list because their cities appear directly; included so the
  // MY_ATOLL filter works for Fuvahmulah and Addu residents.
  ["Gn", "Gnaviyani"],
  ["S", "Seenu"],
];
const atollName = (code: string) => ATOLLS.find(([c]) => c === code)![1];

// Order matches the prototype list (cities/islands first, then atolls).
const PLACES: [name: string, kind: "CITY" | "ISLAND", atoll: string, greaterMale?: boolean][] = [
  ["Malé", "CITY", "K", true],
  ["Hulhumalé", "CITY", "K", true],
  ["Vilimalé", "CITY", "K", true],
  ["Addu City", "CITY", "S"],
  ["Fuvahmulah", "CITY", "Gn"],
  ["Kulhudhuffushi", "CITY", "HDh"],
  ["Thinadhoo", "ISLAND", "GDh"],
  ["Maafushi", "ISLAND", "K"],
  ["Eydhafushi", "ISLAND", "B"],
  ["Naifaru", "ISLAND", "Lh"],
  ["Dhidhdhoo", "ISLAND", "HA"],
  ["Mahibadhoo", "ISLAND", "ADh"],
  ["Funadhoo", "ISLAND", "Sh"],
  ["Ungoofaaru", "ISLAND", "R"],
  ["Veymandoo", "ISLAND", "Th"],
];

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const LOCATIONS: LocationSeed[] = [
  ...PLACES.map(([name, kind, atoll, gm], i) => ({
    slug: slugify(name),
    name,
    kind,
    atollCode: atoll,
    atollName: atollName(atoll),
    isGreaterMale: gm ?? false,
    sortOrder: i,
  })),
  ...ATOLLS.map(([code, name], i) => ({
    slug: `atoll-${slugify(code)}`,
    name: `${code}. Atoll`,
    kind: "ATOLL" as const,
    atollCode: code,
    atollName: name,
    isGreaterMale: false,
    sortOrder: 100 + i,
  })),
];

export const INTERESTS = [
  "Travel", "Diving", "Coffee", "Football", "Photography", "Cooking", "Sketching", "Cycling", "Film",
  "Freediving", "Surfing", "Tea", "Yoga", "Reading", "Baking", "Music", "Art", "Gardening", "Swimming",
  "Poetry", "Chess", "Fishing", "History", "Fashion", "Boduberu", "Gaming", "Vlogging",
].map((label, i) => ({ slug: slugify(label), label, sortOrder: i }));

export const PROMPTS = [
  "My perfect weekend...",
  "The quickest way to win me over...",
  "Something I could talk about for hours...",
  "My ideal first date...",
  "A random fact about me...",
  "You'll usually find me...",
].map((text, i) => ({ slug: `prompt-${i + 1}`, text, sortOrder: i }));

export const PLANS = PLAN_CATALOG.map((p) => ({ ...p, isPlaceholderPrice: true, active: true }));
