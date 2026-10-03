import { RtuRequestParser } from './rtu-request-parser';

const bytes = (hex: string) => Buffer.from(hex.replace(/ /g, ''), 'hex');
// Reference frames with CRC-16/MODBUS computed independently of the app.
const READ_322_X22 = '01 03 01 42 00 16 65 ec'; // read 22 registers from 322
const READ_301 = '01 03 01 2d 00 01 15 ff'; // read register 301
const WRITE_301 = '01 10 01 2d 00 01 02 00 02 31 2c'; // write 2 to register 301

describe('RtuRequestParser', () => {
  it('decodes a read request into its address and register count', () => {
    expect(new RtuRequestParser().push(bytes(READ_322_X22))).toEqual([
      { unit: 1, func: 3, address: 322, quantity: 22, hex: READ_322_X22 },
    ]);
  });

  it('reassembles a request split across reads and skips noise', () => {
    const parser = new RtuRequestParser();
    expect(parser.push(bytes('00 ff 01 03 01'))).toEqual([]);
    expect(parser.push(bytes(`2d 00 01 15 ff aa ${READ_322_X22}`)).map((r) => r.address)).toEqual([301, 322]);
  });

  it('counts write requests it does not decode, without losing the next read', () => {
    const parser = new RtuRequestParser();
    expect(parser.push(bytes(`${WRITE_301} ${READ_301}`)).map((r) => r.address)).toEqual([301]);
    expect(parser.skippedWrites).toBe(1);
  });

  it('drops a request whose CRC does not match', () => {
    expect(new RtuRequestParser().push(bytes('01 03 01 2d 00 01 15 fe'))).toEqual([]);
  });
});
