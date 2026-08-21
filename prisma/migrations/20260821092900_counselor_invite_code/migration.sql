
-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "counselorInviteCode" TEXT,
ADD COLUMN     "counselorInviteExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_counselorInviteCode_key" ON "Profile"("counselorInviteCode");

