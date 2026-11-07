-- AlterTable
ALTER TABLE "bms_devices" ADD COLUMN     "settings" JSONB,
ADD COLUMN     "settingsAt" TIMESTAMP(3);
