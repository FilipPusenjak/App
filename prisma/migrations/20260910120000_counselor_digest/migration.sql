-- The triage digest's own opt-out and cooldown.
--
-- Separate from User.remindersOptOutAt / remindersLastSentAt, which govern the
-- student check-in nudge. An account can hold both a caseload and a child's
-- profile, so one pair of columns could not represent somebody who stopped one
-- stream and not the other.
--
-- Both nullable with no backfill: every existing counselor is opted IN and has
-- never been sent a digest, which is exactly what two nulls mean here.
ALTER TABLE "CounselorAccount" ADD COLUMN "digestOptOutAt" TIMESTAMP(3);
ALTER TABLE "CounselorAccount" ADD COLUMN "digestLastSentAt" TIMESTAMP(3);
