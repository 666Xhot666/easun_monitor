/**
 * Register table for the EASUN ISOLAR SMG-II, transcribed from the vendor's
 * "SMG-RS232 Communication Protocol V1.0.1": devices/smg-ii/registers.json.
 * Addresses are decimal, as in that document. Reserved, "invalid data" and
 * "internal command" addresses are omitted.
 *
 * Names are the keys stored in every reading, so renaming one orphans its
 * history.
 */
import file from '../devices/smg-ii/registers.json';
import { parseRegisterFile } from '../devices/device-files.ts';
import type { RegisterDefinition } from './register-map.ts';

export const SMG_II_REGISTERS: readonly RegisterDefinition[] =
  parseRegisterFile(file, 'devices/smg-ii/registers.json');
