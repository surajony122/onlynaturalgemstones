-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyUserId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "pages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSettings" (
    "shop" TEXT NOT NULL,
    "enforce" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_shop_shopifyUserId_key" ON "TeamMember"("shop", "shopifyUserId");

-- CreateIndex
CREATE INDEX "TeamMember_shop_email_idx" ON "TeamMember"("shop", "email");
