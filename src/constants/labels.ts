/** Human labels for enums, exactly as the prototype words them. */

export const INTENT_LABELS = {
  SERIOUS_RELATIONSHIP: "Serious relationship",
  DATING: "Dating",
  MARRIAGE: "Marriage",
  FIGURING_OUT: "Still figuring it out",
} as const;

export type IntentKey = keyof typeof INTENT_LABELS;

/** Lower-case form used in "Looking for {intent}" pills. */
export function intentLower(intent: IntentKey | string | null | undefined): string | null {
  if (!intent) return null;
  const label = (INTENT_LABELS as Record<string, string>)[intent] ?? intent;
  return label.toLowerCase();
}

/** Dating or Friendship. The subtitles are what make the two feel like different products, not a filter. */
export const CONNECTION_INTENT_LABELS = { DATING: "Dating", FRIENDSHIP: "Friendship" } as const;

export const GENDER_LABELS = { WOMAN: "Woman", MAN: "Man", UNSPECIFIED: "Prefer not to say" } as const;
export const INTERESTED_IN_LABELS = { WOMEN: "Women", MEN: "Men", EVERYONE: "Everyone" } as const;

export const VERIFICATION_LABELS = {
  NONE: "Unverified",
  PHONE_VERIFIED: "Unverified",
  SELFIE_SUBMITTED: "Pending",
  UNDER_REVIEW: "Pending",
  VERIFIED: "Photo verified",
  REJECTED: "Try again",
} as const;

export const REPORT_REASON_LABELS = {
  FAKE_PROFILE: "Fake profile",
  UNDERAGE_USER: "Underage user",
  HARASSMENT: "Harassment",
  INAPPROPRIATE_CONTENT: "Inappropriate content",
  SCAM_OR_FINANCIAL_REQUEST: "Scam or financial request",
  IMPERSONATION: "Impersonation",
  SPAM: "Spam",
  OTHER: "Other",
} as const;
