-- The application document builder: Common App fields on resume items,
-- honors, generated documents and their export snapshots, the compression
-- cache, the generation log behind the monthly caps, and opt-in-only saved
-- resume contact details. Additive only: no existing column changes.
-- AlterTable
ALTER TABLE "ResumeItem" ADD COLUMN     "commonAppType" TEXT,
ADD COLUMN     "facts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gradeLevels" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "positionTitle" TEXT,
ADD COLUMN     "timing" TEXT,
ADD COLUMN     "weeksPerYear" INTEGER;

-- CreateTable
CREATE TABLE "Honor" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "gradeLevels" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "recognitionLevel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Honor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDocument" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "draftKey" TEXT,
    "draftId" TEXT,
    "sourceSnapshot" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "editedFieldKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "exportedAt" TIMESTAMP(3),
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ApplicationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompressionCache" (
    "id" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompressionCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentGenerationLog" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "documentId" TEXT,
    "scope" TEXT NOT NULL,
    "entryKey" TEXT,
    "modelUsed" TEXT,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flaggedEntries" INTEGER NOT NULL DEFAULT 0,
    "fidelityFailures" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentGenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedResumeContact" (
    "profileId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedResumeContact_pkey" PRIMARY KEY ("profileId")
);

-- CreateIndex
CREATE INDEX "Honor_profileId_idx" ON "Honor"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDocument_draftKey_key" ON "ApplicationDocument"("draftKey");

-- CreateIndex
CREATE INDEX "ApplicationDocument_profileId_type_status_idx" ON "ApplicationDocument"("profileId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompressionCache_sourceHash_key" ON "CompressionCache"("sourceHash");

-- CreateIndex
CREATE INDEX "DocumentGenerationLog_profileId_scope_createdAt_idx" ON "DocumentGenerationLog"("profileId", "scope", "createdAt");

-- AddForeignKey
ALTER TABLE "Honor" ADD CONSTRAINT "Honor_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDocument" ADD CONSTRAINT "ApplicationDocument_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGenerationLog" ADD CONSTRAINT "DocumentGenerationLog_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedResumeContact" ADD CONSTRAINT "SavedResumeContact_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

