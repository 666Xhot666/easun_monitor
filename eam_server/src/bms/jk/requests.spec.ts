import {
  CELL_INFO,
  DEVICE_INFO,
  buildRequest,
  isAllowedRequest,
} from './requests';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('JK BMS requests', () => {
  it('builds the 20-byte cell-info and device-info requests', () => {
    // AA 55 90 EB, command, length 0, value 0, zero padding, sum of bytes 0..18.
    expect(hex(buildRequest(CELL_INFO))).toBe(
      'aa5590eb96' + '00'.repeat(14) + '10',
    );
    expect(hex(buildRequest(DEVICE_INFO))).toBe(
      'aa5590eb97' + '00'.repeat(14) + '11',
    );
  });

  it('refuses to build any other command', () => {
    // 0x1d is a MOSFET switch in the reference; 0xa1 the logbook; 0x01 a setting.
    for (const command of [0x1d, 0xa1, 0x01, 0x00, 0xff]) {
      expect(() => buildRequest(command as typeof CELL_INFO)).toThrow(
        /not allowed/,
      );
    }
  });

  it('accepts only well-formed cell-info and device-info requests', () => {
    expect(isAllowedRequest(buildRequest(CELL_INFO))).toBe(true);
    expect(isAllowedRequest(buildRequest(DEVICE_INFO))).toBe(true);

    const withCommand = (command: number) => {
      const frame = Buffer.from(buildRequest(CELL_INFO));
      frame[4] = command;
      frame[19] = [...frame.subarray(0, 19)].reduce(
        (a, b) => (a + b) & 0xff,
        0,
      );
      return frame;
    };
    expect(isAllowedRequest(withCommand(0x1d))).toBe(false); // switch, correctly checksummed
    expect(isAllowedRequest(withCommand(0x05))).toBe(false);

    const withValue = Buffer.from(buildRequest(CELL_INFO));
    withValue[6] = 1;
    withValue[19] = (withValue[19] + 1) & 0xff;
    expect(isAllowedRequest(withValue)).toBe(false); // a value means a write

    expect(isAllowedRequest(buildRequest(CELL_INFO).subarray(0, 19))).toBe(
      false,
    );
    expect(
      isAllowedRequest(
        Buffer.concat([buildRequest(CELL_INFO), Buffer.from([0])]),
      ),
    ).toBe(false);
  });
});
