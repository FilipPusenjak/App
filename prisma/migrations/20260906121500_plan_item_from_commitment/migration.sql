-- Links a plan item back to the commitment the student accepted to create it.
--
-- Additive and nullable: every existing PlannedItem was typed by hand and
-- keeps a NULL here. Postgres allows many NULLs under a unique index, so the
-- constraint only ever constrains derived rows — one plan item per commitment,
-- however many times "I'll do this" is pressed.
ALTER TABLE "PlannedItem" ADD COLUMN "sourceCommitmentId" TEXT;

CREATE UNIQUE INDEX "PlannedItem_sourceCommitmentId_key"
  ON "PlannedItem"("sourceCommitmentId");
