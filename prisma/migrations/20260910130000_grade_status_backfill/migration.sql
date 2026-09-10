-- Everyone who stated a grade before the status field existed is in that grade.
--
-- Safe to assert on this date and not in general, which is why it is a one-time
-- backfill rather than a default on the column. The school year is underway in
-- both hemispheres in September — started in the north, mid-way in the south —
-- so "in progress" is right for essentially every profile already in the table.
-- Running the same statement in June would be wrong for half the world, and a
-- column default would run it every June forever.
--
-- Only rows that state a grade and have no status yet. A profile with no grade
-- has nothing for this to describe, and one that already carries a status
-- carries an answer somebody gave.
UPDATE "Profile"
SET "gradeStatus" = 'in_progress'
WHERE "gradeStatus" IS NULL
  AND "gradeLevel" IS NOT NULL
  AND btrim("gradeLevel") <> '';
