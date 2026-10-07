-- Permission to send an account's data to the AI provider.
--
-- Nullable with no backfill, which means every existing account starts WITHOUT
-- it and is asked on its next AI run. That is the opposite of the dateOfBirth
-- migration's choice, on purpose: there, backfilling would have locked people
-- out under a new rule; here, backfilling would record a permission nobody
-- gave. Being asked once is the whole cost of not inventing it.
ALTER TABLE "User" ADD COLUMN "aiConsentAt" TIMESTAMP(3);
