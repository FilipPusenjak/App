-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "graduationYear" INTEGER,
ADD COLUMN     "majorCategory" TEXT,
ADD COLUMN     "schoolId" TEXT;

-- AlterTable
ALTER TABLE "ResumeItem" ADD COLUMN     "canonicalActivityId" TEXT,
ADD COLUMN     "endGrade" INTEGER,
ADD COLUMN     "rungLevel" TEXT,
ADD COLUMN     "startGrade" INTEGER;

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "ncesId" TEXT,
    "schoolType" TEXT,
    "sizeBand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalActivity" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isHighlyIdentifying" BOOLEAN NOT NULL DEFAULT false,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizationCache" (
    "id" TEXT NOT NULL,
    "rawTextHash" TEXT NOT NULL,
    "canonicalActivityId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizationCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryConsent" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DiscoveryConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "School_ncesId_key" ON "School"("ncesId");

-- CreateIndex
CREATE INDEX "School_country_region_idx" ON "School"("country", "region");

-- CreateIndex
CREATE UNIQUE INDEX "School_name_country_region_key" ON "School"("name", "country", "region");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalActivity_slug_key" ON "CanonicalActivity"("slug");

-- CreateIndex
CREATE INDEX "CanonicalActivity_category_idx" ON "CanonicalActivity"("category");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizationCache_rawTextHash_key" ON "NormalizationCache"("rawTextHash");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryConsent_profileId_key" ON "DiscoveryConsent"("profileId");

-- CreateIndex
CREATE INDEX "DiscoveryConsent_revokedAt_idx" ON "DiscoveryConsent"("revokedAt");

-- CreateIndex
CREATE INDEX "Profile_schoolId_idx" ON "Profile"("schoolId");

-- CreateIndex
CREATE INDEX "Profile_schoolId_majorCategory_graduationYear_idx" ON "Profile"("schoolId", "majorCategory", "graduationYear");

-- CreateIndex
CREATE INDEX "ResumeItem_canonicalActivityId_idx" ON "ResumeItem"("canonicalActivityId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeItem" ADD CONSTRAINT "ResumeItem_canonicalActivityId_fkey" FOREIGN KEY ("canonicalActivityId") REFERENCES "CanonicalActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryConsent" ADD CONSTRAINT "DiscoveryConsent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
