-- CreateTable
CREATE TABLE "inverter_settings_snapshots" (
    "id" SERIAL NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "values" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB,
    "inverterProfileId" INTEGER,

    CONSTRAINT "inverter_settings_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inverter_settings_snapshots_inverterProfileId_readAt_idx" ON "inverter_settings_snapshots"("inverterProfileId", "readAt");

-- AddForeignKey
ALTER TABLE "inverter_settings_snapshots" ADD CONSTRAINT "inverter_settings_snapshots_inverterProfileId_fkey" FOREIGN KEY ("inverterProfileId") REFERENCES "inverter_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
