-- DropIndex
DROP INDEX "Profile_userId_key";

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "countryOfOrigin" TEXT,
ADD COLUMN     "studentName" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeProfileId" TEXT;

-- CreateIndex
CREATE INDEX "Profile_userId_idx" ON "Profile"("userId");
