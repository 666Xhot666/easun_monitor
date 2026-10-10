-- CreateEnum
CREATE TYPE "OutageHouseState" AS ENUM ('PENDING', 'FOUND', 'NOT_FOUND');

-- CreateTable
CREATE TABLE "outage_sources" (
    "id" SERIAL NOT NULL,
    "site" TEXT NOT NULL DEFAULT 'dnem',
    "city" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "houseState" "OutageHouseState" NOT NULL DEFAULT 'PENDING',
    "groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "inverterProfileId" INTEGER NOT NULL,

    CONSTRAINT "outage_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outage_site_streets" (
    "site" TEXT NOT NULL,
    "streets" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outage_site_streets_pkey" PRIMARY KEY ("site")
);

-- CreateIndex
CREATE UNIQUE INDEX "outage_sources_tokenHash_key" ON "outage_sources"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "outage_sources_inverterProfileId_key" ON "outage_sources"("inverterProfileId");

-- AddForeignKey
ALTER TABLE "outage_sources" ADD CONSTRAINT "outage_sources_inverterProfileId_fkey" FOREIGN KEY ("inverterProfileId") REFERENCES "inverter_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

