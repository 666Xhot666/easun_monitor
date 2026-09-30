-- Per-profile time-range queries use one composite index.
DROP INDEX "inverter_logs_inverterProfileId_idx";
CREATE INDEX "inverter_logs_inverterProfileId_timestamp_idx" ON "inverter_logs"("inverterProfileId", "timestamp");

-- Hourly averages for long-range charts. Raw readings are never deleted.
CREATE TABLE "inverter_log_hourly" (
    "inverterProfileId" INTEGER NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "samples" INTEGER NOT NULL,
    "averages" JSONB NOT NULL,

    CONSTRAINT "inverter_log_hourly_pkey" PRIMARY KEY ("inverterProfileId","hour")
);

ALTER TABLE "inverter_log_hourly" ADD CONSTRAINT "inverter_log_hourly_inverterProfileId_fkey" FOREIGN KEY ("inverterProfileId") REFERENCES "inverter_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
