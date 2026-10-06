-- AlterTable
ALTER TABLE "inverter_profiles" ADD COLUMN     "pvMaxCurrentA" DOUBLE PRECISION,
ADD COLUMN     "pvMaxPowerW" DOUBLE PRECISION,
ADD COLUMN     "pvMaxVocV" DOUBLE PRECISION,
ADD COLUMN     "pvMpptMaxV" DOUBLE PRECISION,
ADD COLUMN     "pvMpptMinV" DOUBLE PRECISION,
ADD COLUMN     "pvPanelTypeId" INTEGER,
ADD COLUMN     "pvPanelsInSeries" INTEGER,
ADD COLUMN     "pvStrings" INTEGER;

-- AddForeignKey
ALTER TABLE "inverter_profiles" ADD CONSTRAINT "inverter_profiles_pvPanelTypeId_fkey" FOREIGN KEY ("pvPanelTypeId") REFERENCES "panel_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

