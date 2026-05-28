-- Knowledge Base: articles + categories for self-service portal and agent runbooks.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "KbArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "KbCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KbCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KbArticle" (
  "id" TEXT NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "slug" TEXT NOT NULL,
  "summary" VARCHAR(500),
  "content" TEXT NOT NULL,
  "status" "KbArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "isInternal" BOOLEAN NOT NULL DEFAULT false,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "categoryId" TEXT,
  "authorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "KbCategory_slug_key" ON "KbCategory"("slug");
CREATE INDEX IF NOT EXISTS "KbCategory_slug_idx" ON "KbCategory"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "KbArticle_slug_key" ON "KbArticle"("slug");
CREATE INDEX IF NOT EXISTS "KbArticle_categoryId_idx" ON "KbArticle"("categoryId");
CREATE INDEX IF NOT EXISTS "KbArticle_status_idx" ON "KbArticle"("status");
CREATE INDEX IF NOT EXISTS "KbArticle_slug_idx" ON "KbArticle"("slug");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "KbCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Trigram search indexes (pg_trgm extension already enabled by an earlier migration)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "KbArticle_title_trgm_idx" ON "KbArticle" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "KbArticle_summary_trgm_idx" ON "KbArticle" USING GIN ("summary" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "KbArticle_content_trgm_idx" ON "KbArticle" USING GIN ("content" gin_trgm_ops);
