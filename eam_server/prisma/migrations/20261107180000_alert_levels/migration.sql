-- AlterTable
ALTER TABLE "inverter_profiles" ADD COLUMN     "lowSocAlertPct" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "bms_devices" ADD COLUMN     "cellLowAlertV" DOUBLE PRECISION;
