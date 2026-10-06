-- Custom stones added from the "Gemstone details" page (name/hindi/planet), plus a flag
-- for stones the merchant removed from the built-in list.
ALTER TABLE "GemStoneDetail" ADD COLUMN "label" TEXT;
ALTER TABLE "GemStoneDetail" ADD COLUMN "hindi" TEXT;
ALTER TABLE "GemStoneDetail" ADD COLUMN "planet" TEXT;
ALTER TABLE "GemStoneDetail" ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GemStoneDetail" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
