import { decodeDeviceInfo, variantForSoftware } from './device-info';
import { referenceFrame } from './testing/reference-frames';

// Vectors: device-info frames from syssi/esphome-jk-bms's own tests (see
// testing/); expected values from the frames' comments and the reference's
// jk_bms_ble_*_test.cpp.
describe('decodeDeviceInfo', () => {
  it('reads model, versions, serial number and counters', () => {
    expect(
      decodeDeviceInfo(referenceFrame('DEVICE_INFO_JK02_32S_V11')),
    ).toEqual({
      model: 'JK_PB2A16S15P',
      hardwareVersion: '14.XA',
      softwareVersion: '14.20',
      serialNumber: '3092572134',
      manufacturingDate: '20231118',
      powerOnCount: 148,
      uptimeSeconds: expect.any(Number),
    });
    expect(
      decodeDeviceInfo(referenceFrame('DEVICE_INFO_JK02_32S_V19')),
    ).toMatchObject({
      model: 'JK-PB2A16S20P',
      hardwareVersion: '19A',
      softwareVersion: '19.27',
      powerOnCount: 16,
    });
    expect(
      decodeDeviceInfo(referenceFrame('DEVICE_INFO_JK02_24S_V10')),
    ).toMatchObject({
      model: 'JK-B2A24S20P',
      hardwareVersion: '10.XG',
      softwareVersion: '10.07',
      powerOnCount: 1,
    });
  });

  it('never returns the passcodes the frame carries', () => {
    const decoded = JSON.stringify(
      decodeDeviceInfo(referenceFrame('DEVICE_INFO_JK02_32S_V11')),
    );
    expect(decoded).not.toMatch(/1234|0000|Input Userdata/);
  });

  it('rejects a frame that is not device info', () => {
    expect(() =>
      decodeDeviceInfo(referenceFrame('CELL_INFO_JK02_32S_V11')),
    ).toThrow(/device info/);
  });
});

describe('variantForSoftware', () => {
  it('suggests the variant the reference lists for a software version', () => {
    expect(variantForSoftware('11.261')).toBe('JK02_32S');
    expect(variantForSoftware('19.27')).toBe('JK02_32S');
    expect(variantForSoftware('10.07')).toBe('JK02_24S');
    expect(variantForSoftware('3.3.0')).toBe('JK04');
    expect(variantForSoftware('')).toBeNull();
  });
});
