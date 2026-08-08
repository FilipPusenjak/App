-- CreateTable
CREATE TABLE "CourseRequirement" (
    "id" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "university" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "course" TEXT NOT NULL,
    "cycleYear" INTEGER NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "gatheredOn" TIMESTAMP(3) NOT NULL,
    "primarySourceUrl" TEXT NOT NULL,
    "requirementsJson" TEXT NOT NULL,
    "acceptanceRatePercent" DOUBLE PRECISION,
    "acceptanceRateScope" TEXT,
    "acceptanceRateSourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseRequirement_matchKey_key" ON "CourseRequirement"("matchKey");

-- CreateIndex
CREATE INDEX "CourseRequirement_country_idx" ON "CourseRequirement"("country");
