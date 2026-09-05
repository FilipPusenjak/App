-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "quotaRefunded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Projection" ADD COLUMN     "quotaRefunded" BOOLEAN NOT NULL DEFAULT false;
