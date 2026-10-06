/**
 * JK BMS device-info frame (type 0x03), ported from syssi/esphome-jk-bms
 * (components/jk_bms_ble/jk_bms_ble.cpp, JkBmsBle::decode_device_info_) at
 * commit 59c994e726c34b123e43eb0090736fd94706f0db.
 *
 * The frame also carries the BMS's passcodes and user data (bytes 62-77,
 * 97-133); they are deliberately not decoded, so they are never logged or
 * stored.
 */
import type { BmsProtocol } from './variants';

export const DEVICE_INFO_FRAME = 0x03;

export interface DeviceInfo {
  model: string;
  hardwareVersion: string;
  softwareVersion: string;
  serialNumber: string;
  /** "20YYMMDD", or null when the BMS leaves it empty (JK04). */
  manufacturingDate: string | null;
  powerOnCount: number;
  uptimeSeconds: number;
}

/** ASCII from `start`, up to `length` bytes or the first NUL. */
const text = (frame: Buffer, start: number, length: number) => {
  const field = frame.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? length : end).toString('latin1');
};

export function decodeDeviceInfo(frame: Buffer): DeviceInfo {
  if (frame[4] !== DEVICE_INFO_FRAME) {
    throw new Error(
      `Not a device info frame (type 0x${frame[4].toString(16)})`,
    );
  }
  return {
    model: text(frame, 6, 16),
    hardwareVersion: text(frame, 22, 8),
    softwareVersion: text(frame, 30, 8),
    uptimeSeconds: frame.readUInt32LE(38),
    powerOnCount: frame.readUInt32LE(42),
    manufacturingDate:
      frame[78] === 0 ? null : `20${frame.subarray(78, 84).toString('latin1')}`,
    serialNumber: text(frame, 86, 11),
  };
}

/**
 * The variant the reference's device list implies for a software version:
 * 11.x and later report JK02_32S, 10.x JK02_24S, older (3.x) JK04. Only for
 * a warning at connect time; the configured variant is what decodes, until
 * a real capture has confirmed this rule.
 */
export function variantForSoftware(
  softwareVersion: string,
): BmsProtocol | null {
  const major = Number.parseInt(softwareVersion, 10);
  if (Number.isNaN(major)) return null;
  if (major >= 11) return 'JK02_32S';
  if (major === 10) return 'JK02_24S';
  return 'JK04';
}
