-- The canonical school name, for matching a student's free-text target.
--
-- A target school is whatever a student typed; the catalogue holds one official
-- name each. Matching those on `name` exactly resolves almost nothing, and a
-- test-prep target that resolves nothing has no school setting it — which reads
-- to a tutor as "no bar to clear" rather than as a lookup that failed.
--
-- Nullable with no backfill because there is nothing to backfill: School has no
-- writers anywhere in the app today, so the table is empty and the seed is what
-- first fills it. The lookup skips nulls, so a row written by some future path
-- that forgets this column is invisible to matching rather than wrongly matched.
ALTER TABLE "School" ADD COLUMN "normalizedName" TEXT;

CREATE INDEX "School_normalizedName_country_idx" ON "School" ("normalizedName", "country");
