-- CreateEnum
CREATE TYPE "BatteryType" AS ENUM ('LIFEPO4', 'LEAD_ACID', 'GEL', 'USER_DEFINED');

-- AlterTable
ALTER TABLE "inverter_logs" ADD COLUMN     "inverterProfileId" INTEGER;

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inverter_profiles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 8899,
    "ratedPowerWatts" INTEGER NOT NULL,
    "batteryNominalVoltage" DOUBLE PRECISION NOT NULL,
    "batteryCapacityAh" DOUBLE PRECISION NOT NULL,
    "batteryType" "BatteryType" NOT NULL DEFAULT 'LIFEPO4',
    "lowBatteryCutoffVoltage" DOUBLE PRECISION,
    "bulkChargeVoltage" DOUBLE PRECISION,
    "floatChargeVoltage" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "inverter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "inverter_profiles_userId_idx" ON "inverter_profiles"("userId");

-- CreateIndex
CREATE INDEX "inverter_logs_inverterProfileId_idx" ON "inverter_logs"("inverterProfileId");

-- AddForeignKey
ALTER TABLE "inverter_profiles" ADD CONSTRAINT "inverter_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inverter_logs" ADD CONSTRAINT "inverter_logs_inverterProfileId_fkey" FOREIGN KEY ("inverterProfileId") REFERENCES "inverter_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
