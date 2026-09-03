/**
 * Shape of one successfully decoded telemetry snapshot from the inverter.
 * Matches the required fields of the InverterLog Prisma model 1:1 (id and
 * timestamp are assigned by the database, not the reading itself).
 */
export interface InverterReading {
  gridVoltage: number;
  batteryVoltage: number;
  pvPower: number;
  outputLoadPercent: number;
  inverterMode: string;
}
