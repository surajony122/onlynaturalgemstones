-- AstrologyAPI credentials, so the chart is calculated on the server instead of in the visitor's browser.
ALTER TABLE "AppSettings" ADD COLUMN "astrologyUserId" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "astrologyApiKey" TEXT;
