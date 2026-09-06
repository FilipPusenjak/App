-- Check-in reminder emails: opting out, and not mailing anybody twice.
--
-- All three columns are additive and nullable. Every existing account gets
-- NULLs, which read as: still subscribed, no unsubscribe link minted yet, and
-- never sent a reminder — all true, and all the right starting point.
ALTER TABLE "User" ADD COLUMN "remindersOptOutAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "unsubscribeToken" TEXT;
ALTER TABLE "User" ADD COLUMN "remindersLastSentAt" TIMESTAMP(3);

-- Unique so a token can only ever identify one account. Postgres permits many
-- NULLs under a unique index, so accounts with no token yet are unaffected.
CREATE UNIQUE INDEX "User_unsubscribeToken_key" ON "User"("unsubscribeToken");
