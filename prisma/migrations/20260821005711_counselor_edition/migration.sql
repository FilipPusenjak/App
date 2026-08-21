-- CreateTable
CREATE TABLE "CounselorAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgName" TEXT,
    "type" TEXT NOT NULL DEFAULT 'INDEPENDENT',
    "caseloadLimit" INTEGER NOT NULL DEFAULT 40,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounselorAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseloadLink" (
    "id" TEXT NOT NULL,
    "counselorAccountId" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT NOT NULL,
    "guardianConsentAt" TIMESTAMP(3),
    "studentConsentAt" TIMESTAMP(3),
    "scope" TEXT NOT NULL DEFAULT 'FULL',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseloadLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageSignal" (
    "id" TEXT NOT NULL,
    "caseloadLinkId" TEXT NOT NULL,
    "counselorAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "basis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionPrep" (
    "id" TEXT NOT NULL,
    "caseloadLinkId" TEXT NOT NULL,
    "counselorAccountId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rubricVersion" TEXT NOT NULL,
    "sourceDataVersion" TEXT,
    "modelUsed" TEXT,
    "triageSignalIds" TEXT[],
    "narrative" JSONB,
    "counselorNotes" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "costCents" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionPrep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounselorRecommendation" (
    "id" TEXT NOT NULL,
    "sessionPrepId" TEXT,
    "caseloadLinkId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "linkedCommitmentId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CounselorRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounselorReadLog" (
    "id" TEXT NOT NULL,
    "counselorAccountId" TEXT NOT NULL,
    "caseloadLinkId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CounselorReadLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CounselorAccount_userId_key" ON "CounselorAccount"("userId");

-- CreateIndex
CREATE INDEX "CaseloadLink_counselorAccountId_status_idx" ON "CaseloadLink"("counselorAccountId", "status");

-- CreateIndex
CREATE INDEX "CaseloadLink_studentUserId_status_idx" ON "CaseloadLink"("studentUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CaseloadLink_counselorAccountId_studentProfileId_key" ON "CaseloadLink"("counselorAccountId", "studentProfileId");

-- CreateIndex
CREATE INDEX "TriageSignal_counselorAccountId_severity_resolvedAt_idx" ON "TriageSignal"("counselorAccountId", "severity", "resolvedAt");

-- CreateIndex
CREATE INDEX "TriageSignal_caseloadLinkId_resolvedAt_idx" ON "TriageSignal"("caseloadLinkId", "resolvedAt");

-- CreateIndex
CREATE INDEX "SessionPrep_counselorAccountId_generatedAt_idx" ON "SessionPrep"("counselorAccountId", "generatedAt");

-- CreateIndex
CREATE INDEX "SessionPrep_caseloadLinkId_generatedAt_idx" ON "SessionPrep"("caseloadLinkId", "generatedAt");

-- CreateIndex
CREATE INDEX "CounselorRecommendation_caseloadLinkId_status_idx" ON "CounselorRecommendation"("caseloadLinkId", "status");

-- CreateIndex
CREATE INDEX "CounselorRecommendation_sessionPrepId_idx" ON "CounselorRecommendation"("sessionPrepId");

-- CreateIndex
CREATE INDEX "CounselorReadLog_studentProfileId_readAt_idx" ON "CounselorReadLog"("studentProfileId", "readAt");

-- CreateIndex
CREATE INDEX "CounselorReadLog_counselorAccountId_readAt_idx" ON "CounselorReadLog"("counselorAccountId", "readAt");

-- AddForeignKey
ALTER TABLE "CounselorAccount" ADD CONSTRAINT "CounselorAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseloadLink" ADD CONSTRAINT "CaseloadLink_counselorAccountId_fkey" FOREIGN KEY ("counselorAccountId") REFERENCES "CounselorAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseloadLink" ADD CONSTRAINT "CaseloadLink_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseloadLink" ADD CONSTRAINT "CaseloadLink_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageSignal" ADD CONSTRAINT "TriageSignal_caseloadLinkId_fkey" FOREIGN KEY ("caseloadLinkId") REFERENCES "CaseloadLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPrep" ADD CONSTRAINT "SessionPrep_caseloadLinkId_fkey" FOREIGN KEY ("caseloadLinkId") REFERENCES "CaseloadLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionPrep" ADD CONSTRAINT "SessionPrep_counselorAccountId_fkey" FOREIGN KEY ("counselorAccountId") REFERENCES "CounselorAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselorRecommendation" ADD CONSTRAINT "CounselorRecommendation_sessionPrepId_fkey" FOREIGN KEY ("sessionPrepId") REFERENCES "SessionPrep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselorRecommendation" ADD CONSTRAINT "CounselorRecommendation_caseloadLinkId_fkey" FOREIGN KEY ("caseloadLinkId") REFERENCES "CaseloadLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselorRecommendation" ADD CONSTRAINT "CounselorRecommendation_linkedCommitmentId_fkey" FOREIGN KEY ("linkedCommitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselorReadLog" ADD CONSTRAINT "CounselorReadLog_counselorAccountId_fkey" FOREIGN KEY ("counselorAccountId") REFERENCES "CounselorAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselorReadLog" ADD CONSTRAINT "CounselorReadLog_caseloadLinkId_fkey" FOREIGN KEY ("caseloadLinkId") REFERENCES "CaseloadLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
