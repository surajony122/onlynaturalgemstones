-- WhatsApp OTP login for the storefront's own "My Account" page -- a
-- separate, parallel login system from Shopify's native Customer
-- Accounts (this store is on the Grow plan, so Multipass isn't
-- available to bridge a third-party login into a real Shopify
-- customer session). See schema.prisma's comments on these two models.

-- CreateTable
CREATE TABLE "WhatsAppOtpCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppOtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppOtpCode_phone_idx" ON "WhatsAppOtpCode"("phone");

-- CreateTable
CREATE TABLE "WhatsAppAccountSession" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "phone" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppAccountSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccountSession_tokenHash_key" ON "WhatsAppAccountSession"("tokenHash");

-- CreateIndex
CREATE INDEX "WhatsAppAccountSession_phone_idx" ON "WhatsAppAccountSession"("phone");
