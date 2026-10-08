-- Abandoned checkout reminder email: settings + a per-checkout log + an unsubscribe list.

-- AlterTable
ALTER TABLE "AppSettings"
  ADD COLUMN "abandonedCheckoutEnabled" TEXT,
  ADD COLUMN "abandonedCheckoutEnabledSince" TEXT,
  ADD COLUMN "abandonedCheckoutDelayMinutes" TEXT,
  ADD COLUMN "abandonedCheckoutEmailSubject" TEXT,
  ADD COLUMN "abandonedCheckoutEmailTemplate" TEXT;

-- CreateTable
CREATE TABLE "AbandonedCheckoutEmail" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "checkoutId" TEXT NOT NULL,
    "checkoutName" TEXT,
    "email" TEXT,
    "customerName" TEXT,
    "status" TEXT,
    "snapshot" JSONB,
    "checkoutCreatedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbandonedCheckoutEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbandonedCheckoutOptOut" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbandonedCheckoutOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbandonedCheckoutEmail_checkoutId_key" ON "AbandonedCheckoutEmail"("checkoutId");

-- CreateIndex
CREATE INDEX "AbandonedCheckoutEmail_notifiedAt_idx" ON "AbandonedCheckoutEmail"("notifiedAt");

-- CreateIndex
CREATE INDEX "AbandonedCheckoutEmail_email_notifiedAt_idx" ON "AbandonedCheckoutEmail"("email", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AbandonedCheckoutOptOut_email_key" ON "AbandonedCheckoutOptOut"("email");
