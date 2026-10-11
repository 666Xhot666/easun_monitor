-- CreateTable
CREATE TABLE "server_agent" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "server_agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_samples" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "server_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "server_agent_tokenHash_key" ON "server_agent"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "server_samples_at_key" ON "server_samples"("at");


-- One agent per installation.
ALTER TABLE "server_agent" ADD CONSTRAINT "server_agent_single_row" CHECK ("id" = 1);
