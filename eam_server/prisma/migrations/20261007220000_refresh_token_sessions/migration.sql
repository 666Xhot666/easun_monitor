-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- Tokens issued before sessions existed: each becomes a session of its own.
UPDATE "refresh_tokens" SET "sessionId" = md5(random()::text || "id"::text) WHERE "sessionId" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "sessionId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_sessionId_idx" ON "refresh_tokens"("userId", "sessionId");
