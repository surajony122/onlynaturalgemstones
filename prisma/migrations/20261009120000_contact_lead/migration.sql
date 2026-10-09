-- CreateTable
CREATE TABLE "ContactLead" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactLead_createdAt_idx" ON "ContactLead"("createdAt");

-- CreateIndex
CREATE INDEX "ContactLead_email_createdAt_idx" ON "ContactLead"("email", "createdAt");
