-- Return Received / Refund Processed email templates (Settings page) --
-- same "blank means use the built-in default" convention as
-- orderProcessingEmailTemplate/orderProcessingEmailSubject.
ALTER TABLE "AppSettings" ADD COLUMN "returnReceivedEmailTemplate" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "returnReceivedEmailSubject" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "refundProcessedEmailTemplate" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "refundProcessedEmailSubject" TEXT;

-- CreateTable
CREATE TABLE "OrderReturnEmailNotification" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderName" TEXT,
    "email" TEXT,
    "amount" TEXT,
    "status" TEXT,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReturnEmailNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderReturnEmailNotification_orderId_type_idx" ON "OrderReturnEmailNotification"("orderId", "type");
