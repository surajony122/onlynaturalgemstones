-- AlterTable
ALTER TABLE "AstroLead" ADD COLUMN "shop" TEXT;

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "gmailUser" TEXT,
    "gmailAppPassword" TEXT,
    "googleServiceAccountEmail" TEXT,
    "googleServiceAccountPrivateKey" TEXT,
    "astroLeadsSpreadsheetId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");
