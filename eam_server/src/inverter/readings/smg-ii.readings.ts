/** The SMG-II's common readings, from devices/smg-ii/readings.json. */
import file from '../devices/smg-ii/readings.json';
import { SMG_II_REGISTERS } from '../registers/smg-ii.registers.ts';
import { DeviceReadings, parseReadingsFile } from './device-readings.ts';

export const SMG_II_READINGS = new DeviceReadings(
  parseReadingsFile(file, SMG_II_REGISTERS, 'devices/smg-ii/readings.json'),
);
