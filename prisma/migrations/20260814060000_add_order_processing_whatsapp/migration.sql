-- CreateTable
CREATE TABLE "OrderProcessingNotification" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "phone" TEXT,
    "status" TEXT,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderProcessingNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderProcessingNotification_orderId_key" ON "OrderProcessingNotification"("orderId");

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "interaktOrderTemplateName" TEXT;
