-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "leadAlertEmails" TEXT,
ADD COLUMN "leadAlertAstro" TEXT,
ADD COLUMN "leadAlertWishlist" TEXT,
ADD COLUMN "leadAlertCheckout" TEXT,
ADD COLUMN "leadAlertCheckoutSince" TEXT;

-- CreateTable
CREATE TABLE "LeadAlert" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadAlert_kind_refId_idx" ON "LeadAlert"("kind", "refId");

-- CreateIndex
CREATE INDEX "LeadAlert_createdAt_idx" ON "LeadAlert"("createdAt");
