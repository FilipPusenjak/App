-- CreateTable
CREATE TABLE "PlannedItem" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "org" TEXT,
    "targetDate" TIMESTAMP(3),
    "hoursPerWeek" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projection" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT,
    "promptVersion" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "baseEvaluationId" TEXT,
    "inputSnapshotJson" TEXT,
    "resultJson" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Projection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlannedItem_profileId_idx" ON "PlannedItem"("profileId");

-- CreateIndex
CREATE INDEX "Projection_profileId_idx" ON "Projection"("profileId");

-- AddForeignKey
ALTER TABLE "PlannedItem" ADD CONSTRAINT "PlannedItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projection" ADD CONSTRAINT "Projection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
