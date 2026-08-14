-- CreateTable
CREATE TABLE "WishlistLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackingId" TEXT NOT NULL,
    "shop" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,
    "phone" TEXT,
    "productHandles" JSONB,
    "emailSendStatus" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "WishlistLead_trackingId_key" ON "WishlistLead"("trackingId");
