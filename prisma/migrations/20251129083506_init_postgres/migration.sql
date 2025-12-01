-- CreateTable
CREATE TABLE "Blog" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "primaryKeyword" TEXT NOT NULL,
    "secondaryKeywords" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "outline" TEXT NOT NULL,
    "targetLocation" TEXT NOT NULL,
    "referenceUrls" TEXT NOT NULL,
    "interlinks" TEXT NOT NULL,
    "automationLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Blog_threadId_key" ON "Blog"("threadId");

-- CreateIndex
CREATE INDEX "Blog_threadId_idx" ON "Blog"("threadId");

-- CreateIndex
CREATE INDEX "Blog_createdAt_idx" ON "Blog"("createdAt");
