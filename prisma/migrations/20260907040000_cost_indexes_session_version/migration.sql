-- Three additive changes, none of which rewrites a row.

-- A projection's cost, in cents, beside its token counts. Evaluation has had
-- this column since the start; the projection route simply never got one.
-- NULL on every existing row: those costs were not recorded at the time, and
-- backfilling them at today's prices would present a guess as a record.
ALTER TABLE "Projection" ADD COLUMN "costCents" INTEGER;

-- Signs every other device out when a password is set — see User.sessionVersion.
-- Every existing account starts at 0. Sessions minted before this column
-- existed carry no version and are treated as signed out, so a deploy of this
-- migration logs everybody out exactly once.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Foreign-key columns that are queried on their own, or that Postgres has to
-- scan on a cascade or SET NULL, and that no existing index leads with.
-- Postgres does not index a foreign key by itself.
CREATE INDEX "CaseloadLink_studentProfileId_idx" ON "CaseloadLink"("studentProfileId");
CREATE INDEX "CounselorReadLog_caseloadLinkId_idx" ON "CounselorReadLog"("caseloadLinkId");
CREATE INDEX "Commitment_sourceEvaluationId_idx" ON "Commitment"("sourceEvaluationId");
CREATE INDEX "Development_commitmentId_idx" ON "Development"("commitmentId");
CREATE INDEX "SchoolTestPolicy_testTypeId_idx" ON "SchoolTestPolicy"("testTypeId");
