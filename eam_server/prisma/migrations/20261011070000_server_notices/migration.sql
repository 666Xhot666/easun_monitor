-- CreateTable
CREATE TABLE "server_alert_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "heatC" INTEGER NOT NULL DEFAULT 90,
    "storageFreePercent" INTEGER NOT NULL DEFAULT 10,
    "memoryUsedPercent" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_alert_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_alert_events" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_alert_events_at_idx" ON "server_alert_events"("at");


-- One set of limits per installation.
ALTER TABLE "server_alert_settings" ADD CONSTRAINT "server_alert_settings_single_row" CHECK ("id" = 1);
