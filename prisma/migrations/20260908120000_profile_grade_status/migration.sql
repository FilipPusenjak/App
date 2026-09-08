-- Whether the stated grade level is underway or already finished.
--
-- Nullable with no default and no backfill, deliberately. Every existing row
-- predates the question being asked, and there is no value that could be filled
-- in without guessing exactly the thing this column exists to stop guessing —
-- a northern-hemisphere assumption applied to a southern-hemisphere student is
-- worse than a null the prompt knows how to handle.
ALTER TABLE "Profile" ADD COLUMN "gradeStatus" TEXT;
