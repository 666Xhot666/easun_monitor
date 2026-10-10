-- CreateTable
CREATE TABLE "alert_events" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inverterProfileId" INTEGER NOT NULL,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_events_inverterProfileId_at_idx" ON "alert_events"("inverterProfileId", "at");

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_inverterProfileId_fkey" FOREIGN KEY ("inverterProfileId") REFERENCES "inverter_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
