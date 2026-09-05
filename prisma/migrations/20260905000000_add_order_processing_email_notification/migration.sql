-- CreateTable
CREATE TABLE "OrderProcessingEmailNotification" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "orderId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL DEFAULT 'tag',
    "orderName" TEXT,
    "email" TEXT,
    "status" TEXT,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderProcessingEmailNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderProcessingEmailNotification_orderId_triggerKey_key" ON "OrderProcessingEmailNotification"("orderId", "triggerKey");
