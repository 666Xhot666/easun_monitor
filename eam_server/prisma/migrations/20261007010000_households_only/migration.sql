-- DropForeignKey
ALTER TABLE "panel_types" DROP CONSTRAINT "panel_types_userId_fkey";

-- DropForeignKey
ALTER TABLE "inverter_profiles" DROP CONSTRAINT "inverter_profiles_userId_fkey";

-- DropIndex
DROP INDEX "panel_types_userId_name_key";

-- DropIndex
DROP INDEX "inverter_profiles_userId_idx";

-- AlterTable
ALTER TABLE "panel_types" DROP COLUMN "userId",
ALTER COLUMN "householdId" SET NOT NULL;

-- AlterTable
ALTER TABLE "inverter_profiles" DROP COLUMN "userId",
ALTER COLUMN "householdId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "panel_types_householdId_name_key" ON "panel_types"("householdId", "name");

-- CreateIndex
CREATE INDEX "inverter_profiles_householdId_idx" ON "inverter_profiles"("householdId");

