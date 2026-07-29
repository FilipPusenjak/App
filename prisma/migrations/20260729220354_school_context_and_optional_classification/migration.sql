-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "schoolContext" TEXT,
ADD COLUMN     "schoolName" TEXT;

-- AlterTable
ALTER TABLE "TargetSchool" ALTER COLUMN "classification" DROP NOT NULL;
