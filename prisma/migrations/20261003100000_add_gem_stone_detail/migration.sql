-- Per-stone metal/finger/day/mantra/substitute overrides edited from the app's
-- "Gemstone details" page. A blank column means "use the API/default value".

-- CreateTable
CREATE TABLE "GemStoneDetail" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "gemKey" TEXT NOT NULL,
    "metal" TEXT,
    "finger" TEXT,
    "day" TEXT,
    "mantra" TEXT,
    "substitute" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GemStoneDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GemStoneDetail_shop_gemKey_key" ON "GemStoneDetail"("shop", "gemKey");
