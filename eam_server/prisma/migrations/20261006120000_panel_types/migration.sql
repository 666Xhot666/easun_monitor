-- CreateTable
CREATE TABLE "panel_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "maxPowerW" DOUBLE PRECISION NOT NULL,
    "vmpV" DOUBLE PRECISION NOT NULL,
    "impA" DOUBLE PRECISION NOT NULL,
    "vocV" DOUBLE PRECISION NOT NULL,
    "iscA" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "panel_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "panel_types_userId_name_key" ON "panel_types"("userId", "name");

-- AddForeignKey
ALTER TABLE "panel_types" ADD CONSTRAINT "panel_types_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

