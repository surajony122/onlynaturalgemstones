-- Simple per-article hit counter for the blog post page's "Views" display.

-- CreateTable
CREATE TABLE "ArticleView" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "articleId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleView_articleId_key" ON "ArticleView"("articleId");
