import { z } from "zod";
import { aboutSchema, intentSchema, noMarkup } from "./onboarding";

/**
 * Profile editing and settings schemas (Phase 9). They reuse the onboarding rules so the same field can never have
 * two validation definitions. Zod objects strip unknown keys, so mass assignment is impossible by construction.
 */

export const PROFILE_TEXT_LIMITS = { occupation: 60, education: 60 } as const;
export const HEIGHT_RANGE = { min: 120, max: 230 } as const;

/** Edit profile → Info. Name and date of birth are not editable (prototype: read-only rows). */
export const infoSchema = z.object({
  gender: z.enum(["WOMAN", "MAN", "UNSPECIFIED"]),
  locationId: z.string().min(1).max(64),
  homeLocationId: z.string().min(1).max(64).nullable().default(null),
  occupation: noMarkup(PROFILE_TEXT_LIMITS.occupation, "Occupation").default(""),
  education: noMarkup(PROFILE_TEXT_LIMITS.education, "Education").default(""),
  heightCm: z.number().int().min(HEIGHT_RANGE.min, "Height must be between 120 and 230 cm").max(HEIGHT_RANGE.max, "Height must be between 120 and 230 cm").nullable().default(null),
});
export type InfoInput = z.infer<typeof infoSchema>;

/** Edit profile → About / Interests / Prompts, plus relationship intention. Same rules as onboarding. */
export const aboutEditSchema = aboutSchema.extend({ intent: intentSchema.shape.intent });
export type AboutEditInput = z.infer<typeof aboutEditSchema>;

/** Privacy toggles: only the keys present are changed. Invisible Mode has its own entitlement-checked path. */
export const privacyTogglesSchema = z.object({
  hideLocation: z.boolean().optional(),
  hideAge: z.boolean().optional(),
  hideActiveStatus: z.boolean().optional(),
  blockContacts: z.boolean().optional(),
});
export type PrivacyTogglesInput = z.infer<typeof privacyTogglesSchema>;

export const notificationSettingsSchema = z.object({
  matches: z.boolean().optional(),
  likes: z.boolean().optional(),
  messages: z.boolean().optional(),
  community: z.boolean().optional(),
  marketing: z.boolean().optional(),
});
export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;

export const handleSchema = z.object({ handle: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i) });

/** 32-byte HMAC-SHA-256 digests, hex-encoded, computed on the device (docs/CONTACT_BLOCKING.md §4). */
export const contactHashesSchema = z.object({
  hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/i)).min(1).max(5000),
  source: z.enum(["PICKER", "MANUAL"]),
});

export const otpConfirmSchema = z.object({ challengeId: z.string().min(1).max(64), code: z.string().min(1).max(12) });
