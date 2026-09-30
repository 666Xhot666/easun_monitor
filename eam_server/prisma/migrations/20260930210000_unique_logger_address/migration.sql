-- One inverter profile per logger address.
--
-- Profiles that already share an address are the same physical logger, so
-- they are merged into the oldest one: the others' readings are re-pointed
-- to it and the duplicate profiles are removed. No readings are lost.
WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY "ipAddress", port ORDER BY id) AS keeper
  FROM "inverter_profiles"
)
UPDATE "inverter_logs" AS logs
SET "inverterProfileId" = ranked.keeper
FROM ranked
WHERE logs."inverterProfileId" = ranked.id AND ranked.id <> ranked.keeper;

DELETE FROM "inverter_profiles" AS p
USING "inverter_profiles" AS keeper
WHERE p."ipAddress" = keeper."ipAddress"
  AND p.port = keeper.port
  AND p.id > keeper.id;

-- CreateIndex
CREATE UNIQUE INDEX "inverter_profiles_ipAddress_port_key" ON "inverter_profiles"("ipAddress", "port");
