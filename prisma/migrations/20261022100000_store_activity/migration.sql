-- CreateTable
CREATE TABLE "StoreDeletionEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT,
    "title" TEXT,
    "detail" TEXT,
    "source" TEXT NOT NULL,
    "actor" TEXT,
    "happenedAt" TIMESTAMP(3),
    "windowStart" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "StoreDeletionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileSnapshotItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSnapshotRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "StoreSnapshotRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreDeletionEvent_shop_detectedAt_idx" ON "StoreDeletionEvent"("shop", "detectedAt");

-- CreateIndex
CREATE INDEX "StoreDeletionEvent_kind_detectedAt_idx" ON "StoreDeletionEvent"("kind", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FileSnapshotItem_shop_kind_itemId_key" ON "FileSnapshotItem"("shop", "kind", "itemId");

-- CreateIndex
CREATE INDEX "FileSnapshotItem_shop_kind_idx" ON "FileSnapshotItem"("shop", "kind");

-- CreateIndex
CREATE INDEX "StoreSnapshotRun_shop_kind_ranAt_idx" ON "StoreSnapshotRun"("shop", "kind", "ranAt");
