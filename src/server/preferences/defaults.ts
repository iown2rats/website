/**
 * The age range a preferences row starts with, in the shape Prisma writes it. Every place that creates a
 * DiscoveryPreferences row spreads this, so no row depends on the database column default to get its range, and the
 * number itself lives only in `DISCOVERY.defaultAgeRange` (src/config/product.ts).
 */
import { DISCOVERY } from "@/config/product";

export const DEFAULT_AGE_PREFERENCES = {
  ageMin: DISCOVERY.defaultAgeRange.min,
  ageMax: DISCOVERY.defaultAgeRange.max,
} as const;
