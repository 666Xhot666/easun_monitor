-- AlterTable
ALTER TABLE "server_alert_events" ADD COLUMN     "key" TEXT,
ADD COLUMN     "params" JSONB;
