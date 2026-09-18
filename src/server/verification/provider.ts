/**
 * Verification review provider (docs/ARCHITECTURE.md §11). The only implementation is human review: a submitted
 * selfie goes straight to UNDER_REVIEW and an admin or moderator compares it with the profile photos by eye. No face
 * recognition, no biometric similarity score, no external API. A future provider would implement the same interface.
 */
export interface VerificationSubmission {
  userId: string;
  selfieKey: string;
  profilePhotoKeys: string[];
}

export interface VerificationProvider {
  readonly id: string;
  submit(input: VerificationSubmission): Promise<{ providerRef: string | null; status: "SELFIE_SUBMITTED" | "UNDER_REVIEW" }>;
}

export const manualReviewProvider: VerificationProvider = {
  id: "manual_review",
  async submit() {
    return { providerRef: null, status: "UNDER_REVIEW" };
  },
};
