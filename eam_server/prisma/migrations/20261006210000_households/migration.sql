-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('ADMIN', 'READER');

-- AlterTable
ALTER TABLE "panel_types" ADD COLUMN     "householdId" INTEGER;

-- AlterTable
ALTER TABLE "inverter_profiles" ADD COLUMN     "householdId" INTEGER;

-- CreateTable
CREATE TABLE "households" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_memberships" (
    "id" SERIAL NOT NULL,
    "role" "HouseholdRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,
    "householdId" INTEGER NOT NULL,

    CONSTRAINT "household_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "household_memberships_householdId_idx" ON "household_memberships"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "household_memberships_userId_householdId_key" ON "household_memberships"("userId", "householdId");

-- AddForeignKey
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_types" ADD CONSTRAINT "panel_types_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inverter_profiles" ADD CONSTRAINT "inverter_profiles_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every existing user gets their own household (same id as the
-- user, so the mapping is direct) as its ADMIN, and their inverters and
-- panel types move into it.
INSERT INTO "households" ("id", "name", "createdAt", "updatedAt")
SELECT "id", 'Home', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "users";

SELECT setval(pg_get_serial_sequence('"households"', 'id'), COALESCE((SELECT max("id") FROM "households"), 0) + 1, false);

INSERT INTO "household_memberships" ("role", "userId", "householdId")
SELECT 'ADMIN', "id", "id" FROM "users";

UPDATE "inverter_profiles" SET "householdId" = "userId";
UPDATE "panel_types" SET "householdId" = "userId";
