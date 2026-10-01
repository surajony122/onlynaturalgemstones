-- OTP verification for the storefront's Gem Recommendation ("Astro
-- Advice") form. Separate table from WhatsAppOtpCode (the "My Account"
-- login OTP) since this form verifies a phone AND email together in
-- one step, and uses a 4-digit code instead of 6. See schema.prisma.

-- CreateTable
CREATE TABLE "GemAdviceOtpCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemAdviceOtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GemAdviceOtpCode_phone_idx" ON "GemAdviceOtpCode"("phone");

-- CreateIndex
CREATE INDEX "GemAdviceOtpCode_email_idx" ON "GemAdviceOtpCode"("email");
