/*
  Warnings:

  - You are about to drop the column `batteryVoltage` on the `inverter_logs` table. All the data in the column will be lost.
  - You are about to drop the column `gridVoltage` on the `inverter_logs` table. All the data in the column will be lost.
  - You are about to drop the column `inverterMode` on the `inverter_logs` table. All the data in the column will be lost.
  - You are about to drop the column `outputLoadPercent` on the `inverter_logs` table. All the data in the column will be lost.
  - You are about to drop the column `pvPower` on the `inverter_logs` table. All the data in the column will be lost.
  - Added the required column `payload` to the `inverter_logs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "inverter_logs" DROP COLUMN "batteryVoltage",
DROP COLUMN "gridVoltage",
DROP COLUMN "inverterMode",
DROP COLUMN "outputLoadPercent",
DROP COLUMN "pvPower",
ADD COLUMN     "payload" JSONB NOT NULL;
