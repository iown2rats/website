import { z } from "zod";
import { INTEREST_LIMITS, PROMPT_LIMITS } from "@/config/product";

/**
 * Onboarding and profile input schemas. Every server action validates with these; the client reuses
 * them for inline hints only. Text fields reject markup characters outright (React escapes output too).
 */

export const noMarkup = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${label} is too long`).refine((s) => !/[<>]/.test(s), `${label} can't contain < or >`));

export const nameSchema = z.object({
  name: noMarkup(40, "Name").pipe(z.string().min(2, "Enter at least 2 characters")),
});

export const dobSchema = z
  .object({
    day: z.coerce.number().int().min(1).max(31),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(1900).max(2100),
  })
  .refine((v) => {
    const d = new Date(Date.UTC(v.year, v.month - 1, v.day));
    return d.getUTCFullYear() === v.year && d.getUTCMonth() === v.month - 1 && d.getUTCDate() === v.day;
  }, "That date doesn't exist");

export const genderSchema = z.object({ gender: z.enum(["WOMAN", "MAN", "UNSPECIFIED"]) });
/** Friendship only: Dating derives its preference from gender and never accepts one from a request. */
export const meetSchema = z.object({ interestedIn: z.enum(["WOMEN", "MEN", "EVERYONE"]) });
export const connectionSchema = z.object({ connectionIntent: z.enum(["DATING", "FRIENDSHIP"]) });
export const intentSchema = z.object({ intent: z.enum(["SERIOUS_RELATIONSHIP", "DATING", "MARRIAGE", "FIGURING_OUT"]) });
export const locationSchema = z.object({ locationId: z.string().min(1).max(64) });

export const aboutSchema = z.object({
  bio: noMarkup(300, "Bio").optional().default(""),
  interestIds: z.array(z.string().min(1).max(64)).max(INTEREST_LIMITS.max, `Pick up to ${INTEREST_LIMITS.max} interests`).default([]),
  prompts: z
    .array(z.object({ promptId: z.string().min(1).max(64), answer: noMarkup(200, "Answer").pipe(z.string().min(1, "Write an answer")) }))
    .max(PROMPT_LIMITS.max, `Choose up to ${PROMPT_LIMITS.max} prompts`)
    .default([]),
});

export const privacySchema = z.object({
  hideLocation: z.boolean().default(false),
  hideAge: z.boolean().default(false),
  blockContacts: z.boolean().default(false),
});

export const reorderPhotosSchema = z.object({ photoIds: z.array(z.string().min(1).max(64)).min(1).max(6) });
export const photoIdSchema = z.object({ photoId: z.string().min(1).max(64) });

export type NameInput = z.infer<typeof nameSchema>;
export type DobInput = z.infer<typeof dobSchema>;
export type AboutInput = z.infer<typeof aboutSchema>;
export type PrivacyInput = z.infer<typeof privacySchema>;
