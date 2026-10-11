-- Registers identified from the vendor protocol were renamed (see
-- smg-ii.registers.ts); readings stored under the old names move to the new
-- ones, so their history stays with them.

UPDATE "inverter_logs" SET "payload" = ("payload" - 'Unverified200') || jsonb_build_object('Internal200', "payload" -> 'Unverified200') WHERE "payload" ? 'Unverified200';
UPDATE "inverter_logs" SET "payload" = ("payload" - 'Unverified218') || jsonb_build_object('Internal218', "payload" -> 'Unverified218') WHERE "payload" ? 'Unverified218';
UPDATE "inverter_logs" SET "payload" = ("payload" - 'Unverified228') || jsonb_build_object('PVTemperature', "payload" -> 'Unverified228') WHERE "payload" ? 'Unverified228';
UPDATE "inverter_logs" SET "payload" = ("payload" - 'Unverified230') || jsonb_build_object('Internal230', "payload" -> 'Unverified230') WHERE "payload" ? 'Unverified230';
UPDATE "inverter_logs" SET "payload" = ("payload" - 'Unverified231') || jsonb_build_object('PowerFlow', "payload" -> 'Unverified231') WHERE "payload" ? 'Unverified231';
UPDATE "inverter_logs" SET "payload" = ("payload" - 'Unverified235') || jsonb_build_object('ExternalCtPowerHigh', "payload" -> 'Unverified235') WHERE "payload" ? 'Unverified235';

UPDATE "inverter_log_hourly" SET "averages" = ("averages" - 'Unverified200') || jsonb_build_object('Internal200', "averages" -> 'Unverified200') WHERE "averages" ? 'Unverified200';
UPDATE "inverter_log_hourly" SET "averages" = ("averages" - 'Unverified218') || jsonb_build_object('Internal218', "averages" -> 'Unverified218') WHERE "averages" ? 'Unverified218';
UPDATE "inverter_log_hourly" SET "averages" = ("averages" - 'Unverified228') || jsonb_build_object('PVTemperature', "averages" -> 'Unverified228') WHERE "averages" ? 'Unverified228';
UPDATE "inverter_log_hourly" SET "averages" = ("averages" - 'Unverified230') || jsonb_build_object('Internal230', "averages" -> 'Unverified230') WHERE "averages" ? 'Unverified230';
UPDATE "inverter_log_hourly" SET "averages" = ("averages" - 'Unverified231') || jsonb_build_object('PowerFlow', "averages" -> 'Unverified231') WHERE "averages" ? 'Unverified231';
UPDATE "inverter_log_hourly" SET "averages" = ("averages" - 'Unverified235') || jsonb_build_object('ExternalCtPowerHigh', "averages" -> 'Unverified235') WHERE "averages" ? 'Unverified235';
