-- In-app reports of AI-generated content. See the ContentReport model.
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentReport_resolvedAt_createdAt_idx" ON "ContentReport"("resolvedAt", "createdAt");
CREATE INDEX "ContentReport_kind_targetId_idx" ON "ContentReport"("kind", "targetId");

ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
