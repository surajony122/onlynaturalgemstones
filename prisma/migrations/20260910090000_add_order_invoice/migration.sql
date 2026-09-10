-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "invoiceGstin" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceSellerLegalName" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceSellerAddress" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceSellerState" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceGstRateLoose" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceGstRateCustomisation" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceNumberPrefix" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceNextNumber" INTEGER;
ALTER TABLE "AppSettings" ADD COLUMN "invoicePdfTemplate" TEXT;

-- CreateTable
CREATE TABLE "OrderInvoice" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "sentTo" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderInvoice_orderId_key" ON "OrderInvoice"("orderId");
