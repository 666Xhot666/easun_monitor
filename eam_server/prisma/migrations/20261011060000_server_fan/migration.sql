-- CreateEnum
CREATE TYPE "ServerFanMode" AS ENUM ('FIRMWARE', 'AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "server_fan_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mode" "ServerFanMode" NOT NULL DEFAULT 'FIRMWARE',
    "minPercent" INTEGER NOT NULL DEFAULT 0,
    "manualPercent" INTEGER NOT NULL DEFAULT 100,
    "rules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_fan_settings_pkey" PRIMARY KEY ("id")
);


-- One set of fan settings per installation.
ALTER TABLE "server_fan_settings" ADD CONSTRAINT "server_fan_settings_single_row" CHECK ("id" = 1);
