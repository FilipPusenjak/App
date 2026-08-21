
-- CreateTable
CREATE TABLE "TestType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectionSchema" JSONB NOT NULL,
    "compositeRule" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreAttempt" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "testTypeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "sectionScores" JSONB NOT NULL,
    "composite" INTEGER,
    "enteredBy" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolTestPolicy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "testTypeId" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "superscores" BOOLEAN NOT NULL DEFAULT false,
    "scoreChoice" BOOLEAN NOT NULL DEFAULT false,
    "p25" INTEGER,
    "p50" INTEGER,
    "p75" INTEGER,
    "sourceDataVersion" TEXT NOT NULL,
    "effectiveCycle" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolTestPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreTarget" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "testTypeId" TEXT NOT NULL,
    "bindingComposite" INTEGER,
    "bindingSchoolId" TEXT,
    "bandLow" INTEGER,
    "bandHigh" INTEGER,
    "excludedBlindSchoolIds" TEXT[],
    "nonBindingOptionalSchoolIds" TEXT[],
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rubricVersion" TEXT NOT NULL,
    "sourceDataVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionAllocation" (
    "id" TEXT NOT NULL,
    "scoreTargetId" TEXT NOT NULL,
    "sectionName" TEXT NOT NULL,
    "currentScore" INTEGER,
    "headroom" INTEGER NOT NULL,
    "pointsPerUnitEffort" DOUBLE PRECISION NOT NULL,
    "recommendedFocus" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoppingSignal" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "testTypeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedByTutorAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "basis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoppingSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressArtifact" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "caseloadLinkId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "narrative" JSONB,
    "tutorNote" TEXT,
    "sharedWithGuardianAt" TIMESTAMP(3),
    "rubricVersion" TEXT NOT NULL,
    "sourceDataVersion" TEXT,
    "promptVersion" TEXT,
    "modelUsed" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "costCents" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestType_code_key" ON "TestType"("code");

-- CreateIndex
CREATE INDEX "ScoreAttempt_studentUserId_testTypeId_takenAt_idx" ON "ScoreAttempt"("studentUserId", "testTypeId", "takenAt");

-- CreateIndex
CREATE INDEX "SchoolTestPolicy_schoolId_testTypeId_idx" ON "SchoolTestPolicy"("schoolId", "testTypeId");

-- CreateIndex
CREATE INDEX "SchoolTestPolicy_sourceDataVersion_idx" ON "SchoolTestPolicy"("sourceDataVersion");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolTestPolicy_schoolId_testTypeId_effectiveCycle_key" ON "SchoolTestPolicy"("schoolId", "testTypeId", "effectiveCycle");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreTarget_studentUserId_testTypeId_key" ON "ScoreTarget"("studentUserId", "testTypeId");

-- CreateIndex
CREATE INDEX "SectionAllocation_scoreTargetId_idx" ON "SectionAllocation"("scoreTargetId");

-- CreateIndex
CREATE INDEX "StoppingSignal_studentUserId_testTypeId_resolvedAt_idx" ON "StoppingSignal"("studentUserId", "testTypeId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ProgressArtifact_studentUserId_periodEnd_idx" ON "ProgressArtifact"("studentUserId", "periodEnd");

-- CreateIndex
CREATE INDEX "ProgressArtifact_caseloadLinkId_generatedAt_idx" ON "ProgressArtifact"("caseloadLinkId", "generatedAt");

-- AddForeignKey
ALTER TABLE "ScoreAttempt" ADD CONSTRAINT "ScoreAttempt_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAttempt" ADD CONSTRAINT "ScoreAttempt_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "TestType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTestPolicy" ADD CONSTRAINT "SchoolTestPolicy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolTestPolicy" ADD CONSTRAINT "SchoolTestPolicy_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "TestType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreTarget" ADD CONSTRAINT "ScoreTarget_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreTarget" ADD CONSTRAINT "ScoreTarget_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "TestType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreTarget" ADD CONSTRAINT "ScoreTarget_bindingSchoolId_fkey" FOREIGN KEY ("bindingSchoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAllocation" ADD CONSTRAINT "SectionAllocation_scoreTargetId_fkey" FOREIGN KEY ("scoreTargetId") REFERENCES "ScoreTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoppingSignal" ADD CONSTRAINT "StoppingSignal_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoppingSignal" ADD CONSTRAINT "StoppingSignal_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "TestType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressArtifact" ADD CONSTRAINT "ProgressArtifact_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressArtifact" ADD CONSTRAINT "ProgressArtifact_caseloadLinkId_fkey" FOREIGN KEY ("caseloadLinkId") REFERENCES "CaseloadLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

