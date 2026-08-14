-- CreateTable
CREATE TABLE "WebhookReceiptLog" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shop" TEXT,
    "orderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceiptLog_pkey" PRIMARY KEY ("id")
);
