-- CreateTable
CREATE TABLE "inverter_logs" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gridVoltage" DOUBLE PRECISION NOT NULL,
    "batteryVoltage" DOUBLE PRECISION NOT NULL,
    "pvPower" DOUBLE PRECISION NOT NULL,
    "outputLoadPercent" DOUBLE PRECISION NOT NULL,
    "inverterMode" TEXT NOT NULL,

    CONSTRAINT "inverter_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inverter_logs_timestamp_idx" ON "inverter_logs"("timestamp");
