-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "differentiationSnapshotJson" TEXT,
ADD COLUMN     "materialChange" BOOLEAN,
ADD COLUMN     "paceStatus" TEXT,
ADD COLUMN     "precedingEvaluationId" TEXT,
ADD COLUMN     "rubricVersion" TEXT,
ADD COLUMN     "sourceDataVersion" TEXT,
ADD COLUMN     "thresholdSnapshotJson" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'DEEP_REVIEW';

-- CreateTable
CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceEvaluationId" TEXT,
    "description" TEXT NOT NULL,
    "targetRung" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "resolvedAt" TIMESTAMP(3),
    "resolvedInEvaluationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileDigest" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "throughGrade" INTEGER NOT NULL,
    "summaryJson" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rubricVersion" TEXT,
    "model" TEXT,

    CONSTRAINT "ProfileDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Commitment_profileId_status_idx" ON "Commitment"("profileId", "status");

-- CreateIndex
CREATE INDEX "ProfileDigest_profileId_idx" ON "ProfileDigest"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileDigest_profileId_throughGrade_key" ON "ProfileDigest"("profileId", "throughGrade");

-- CreateIndex
CREATE INDEX "Evaluation_profileId_type_createdAt_idx" ON "Evaluation"("profileId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_precedingEvaluationId_fkey" FOREIGN KEY ("precedingEvaluationId") REFERENCES "Evaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_sourceEvaluationId_fkey" FOREIGN KEY ("sourceEvaluationId") REFERENCES "Evaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_resolvedInEvaluationId_fkey" FOREIGN KEY ("resolvedInEvaluationId") REFERENCES "Evaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileDigest" ADD CONSTRAINT "ProfileDigest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
