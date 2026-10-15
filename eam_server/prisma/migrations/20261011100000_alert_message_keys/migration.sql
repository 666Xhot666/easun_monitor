-- AlterTable
ALTER TABLE "alert_events" ADD COLUMN     "key" TEXT,
ADD COLUMN     "params" JSONB;
