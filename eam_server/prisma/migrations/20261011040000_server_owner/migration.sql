-- AlterTable
ALTER TABLE "users" ADD COLUMN     "serverViewer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "server_owner" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "server_owner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "server_owner_userId_key" ON "server_owner"("userId");

-- AddForeignKey
ALTER TABLE "server_owner" ADD CONSTRAINT "server_owner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One owner for the whole installation.
ALTER TABLE "server_owner" ADD CONSTRAINT "server_owner_single_row" CHECK ("id" = 1);

-- An existing installation: its first account becomes the owner.
INSERT INTO "server_owner" ("id", "userId")
SELECT 1, "id" FROM "users" ORDER BY "id" LIMIT 1;
