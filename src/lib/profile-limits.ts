/**
 * Edit profile field limits, shared by the Zod schemas (src/lib/validation/profile.ts) and the Edit profile form.
 * Kept free of Zod so the client form does not pull the whole validation library into its bundle for three numbers.
 */
export const PROFILE_TEXT_LIMITS = { occupation: 60, education: 60 } as const;
export const HEIGHT_RANGE = { min: 120, max: 230 } as const;
