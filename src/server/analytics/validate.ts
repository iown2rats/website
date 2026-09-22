/**
 * What the ingest endpoint will accept (docs/ARCHITECTURE.md §30.3).
 *
 * Kept out of the route file so it can be tested directly: the shape of what a hostile caller may post is a
 * security boundary, and a boundary that can only be exercised through an HTTP handler tends not to be exercised.
 */
import { z } from "zod";

/** Nothing legitimate here is more than a few hundred bytes; the ceiling is checked before parsing. */
export const MAX_ANALYTICS_BODY_BYTES = 4_096;

export const analyticsBodySchema = z.object({
  /**
   * A UUID, and the shape is enforced rather than assumed.
   *
   * This is the primary key of the duplicate rule, so a caller able to supply an arbitrary string could pick one
   * deliberately and — because the insert is ON CONFLICT DO NOTHING — permanently suppress somebody else's event
   * by getting there first. A random 122-bit value cannot be guessed, and a value that is not one is refused.
   */
  eventKey: z.string().uuid(),
  type: z.enum(["PAGE_VIEW", "SESSION_START", "SIGNUP_STARTED", "SIGNUP_COMPLETED", "LOGIN", "ONBOARDING_COMPLETED"]),
  /** Normalised and identifier-stripped server-side; the length cap is only to stop an oversized body. */
  path: z.string().max(2_048).optional().nullable(),
  referrer: z.string().max(2_048).optional().nullable(),
});

export type AnalyticsBody = z.infer<typeof analyticsBodySchema>;

/** Parses a raw request body. Returns null for anything malformed — a bad body is ignored, never repaired. */
export function parseAnalyticsBody(raw: string): AnalyticsBody | null {
  if (raw.length > MAX_ANALYTICS_BODY_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = analyticsBodySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
