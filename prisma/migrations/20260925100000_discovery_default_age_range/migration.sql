-- The database's own fallback age range for DiscoveryPreferences, aligned with the one canonical default
-- (DISCOVERY.defaultAgeRange in src/config/product.ts). Metadata only: no existing row is read or changed, and the
-- application writes the range explicitly on every row it creates, so this matters only to a row inserted by hand.
ALTER TABLE "DiscoveryPreferences" ALTER COLUMN "ageMin" SET DEFAULT 18,
ALTER COLUMN "ageMax" SET DEFAULT 60;
