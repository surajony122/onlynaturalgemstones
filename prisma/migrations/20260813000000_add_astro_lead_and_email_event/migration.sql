-- CreateTable
CREATE TABLE "AstroLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "gender" TEXT,
    "purpose" TEXT,
    "bodyWeightKg" DOUBLE PRECISION,
    "dob" TEXT,
    "tob" TEXT,
    "placeOfBirth" TEXT,
    "ascendant" TEXT,
    "moonsign" TEXT,
    "sunsign" TEXT,
    "lifeStoneGem" TEXT,
    "lifeStonePlanet" TEXT,
    "beneficStoneGem" TEXT,
    "luckyStoneGem" TEXT,
    "recommendation" JSONB,
    "calculationOk" BOOLEAN NOT NULL DEFAULT true,
    "astroError" TEXT,
    "shopifySyncStatus" TEXT,
    "emailSendStatus" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "AstroLead_trackingId_key" ON "AstroLead"("trackingId");

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackingId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EmailEvent_trackingId_idx" ON "EmailEvent"("trackingId");
