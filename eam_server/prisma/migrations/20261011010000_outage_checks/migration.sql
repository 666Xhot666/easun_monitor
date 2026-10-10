-- CreateEnum
CREATE TYPE "OutageCheckOutcome" AS ENUM ('OK', 'CHALLENGE', 'REJECTED', 'SHAPE', 'SERVER', 'NETWORK');

-- CreateTable
CREATE TABLE "outage_checks" (
    "id" SERIAL NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "outcome" "OutageCheckOutcome" NOT NULL,
    "usedBrowser" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "sourceId" INTEGER NOT NULL,

    CONSTRAINT "outage_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outage_weekly_patterns" (
    "id" SERIAL NOT NULL,
    "group" TEXT NOT NULL,
    "days" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "sourceId" INTEGER NOT NULL,

    CONSTRAINT "outage_weekly_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outage_confirmed_days" (
    "id" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "group" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "siteUpdated" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "sourceId" INTEGER NOT NULL,

    CONSTRAINT "outage_confirmed_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outage_checks_sourceId_checkedAt_key" ON "outage_checks"("sourceId", "checkedAt");

-- CreateIndex
CREATE INDEX "outage_weekly_patterns_sourceId_group_seenAt_idx" ON "outage_weekly_patterns"("sourceId", "group", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "outage_confirmed_days_sourceId_group_day_key" ON "outage_confirmed_days"("sourceId", "group", "day");

-- AddForeignKey
ALTER TABLE "outage_checks" ADD CONSTRAINT "outage_checks_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "outage_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outage_weekly_patterns" ADD CONSTRAINT "outage_weekly_patterns_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "outage_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outage_confirmed_days" ADD CONSTRAINT "outage_confirmed_days_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "outage_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

