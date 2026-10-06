import { parseBmsProtocol } from './variants';

describe('parseBmsProtocol', () => {
  it('defaults to JK02_32S and accepts the known variants in any case', () => {
    expect(parseBmsProtocol(undefined)).toBe('JK02_32S');
    expect(parseBmsProtocol('')).toBe('JK02_32S');
    expect(parseBmsProtocol('jk02_24s')).toBe('JK02_24S');
    expect(parseBmsProtocol(' JK04 ')).toBe('JK04');
  });

  it('refuses anything else', () => {
    expect(() => parseBmsProtocol('JK02')).toThrow(
      /BMS_PROTOCOL must be one of/,
    );
  });
});
