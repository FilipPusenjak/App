-- CreateTable
CREATE TABLE "Development" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "commitmentId" TEXT,
    "readByEvaluationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Development_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Development_profileId_createdAt_idx" ON "Development"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "Development" ADD CONSTRAINT "Development_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Development" ADD CONSTRAINT "Development_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
