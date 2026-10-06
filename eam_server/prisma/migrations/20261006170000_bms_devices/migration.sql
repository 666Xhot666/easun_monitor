-- CreateTable
CREATE TABLE "bms_devices" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "bluetoothId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "inverterProfileId" INTEGER NOT NULL,

    CONSTRAINT "bms_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bms_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "bmsDeviceId" INTEGER NOT NULL,

    CONSTRAINT "bms_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bms_log_hourly" (
    "bmsDeviceId" INTEGER NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "samples" INTEGER NOT NULL,
    "averages" JSONB NOT NULL,

    CONSTRAINT "bms_log_hourly_pkey" PRIMARY KEY ("bmsDeviceId","hour")
);

-- CreateIndex
CREATE UNIQUE INDEX "bms_devices_tokenHash_key" ON "bms_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "bms_devices_inverterProfileId_idx" ON "bms_devices"("inverterProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "bms_logs_bmsDeviceId_timestamp_key" ON "bms_logs"("bmsDeviceId", "timestamp");

-- AddForeignKey
ALTER TABLE "bms_devices" ADD CONSTRAINT "bms_devices_inverterProfileId_fkey" FOREIGN KEY ("inverterProfileId") REFERENCES "inverter_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bms_logs" ADD CONSTRAINT "bms_logs_bmsDeviceId_fkey" FOREIGN KEY ("bmsDeviceId") REFERENCES "bms_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bms_log_hourly" ADD CONSTRAINT "bms_log_hourly_bmsDeviceId_fkey" FOREIGN KEY ("bmsDeviceId") REFERENCES "bms_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

