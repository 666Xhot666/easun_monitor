-- CreateEnum
CREATE TYPE "OutageEventKind" AS ENUM ('SCHEDULE', 'REPAIR');

-- CreateEnum
CREATE TYPE "OutageEventStatus" AS ENUM ('OFF', 'POSSIBLE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "outage_events" (
    "id" SERIAL NOT NULL,
    "kind" "OutageEventKind" NOT NULL,
    "status" "OutageEventStatus" NOT NULL,
    "description" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "announcedStart" TIMESTAMP(3) NOT NULL,
    "announcedEnd" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "revisedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "sourceId" INTEGER NOT NULL,

    CONSTRAINT "outage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outage_events_sourceId_start_idx" ON "outage_events"("sourceId", "start");

-- AddForeignKey
ALTER TABLE "outage_events" ADD CONSTRAINT "outage_events_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "outage_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

