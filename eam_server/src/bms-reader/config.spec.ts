import { readerConfig } from './config';

describe('readerConfig', () => {
  it('has defaults for everything but delivery', () => {
    expect(readerConfig({})).toEqual({
      name: 'JK-',
      id: null,
      protocol: 'JK02_32S',
      ingest: null,
      sendIntervalMs: 5000,
      captureDir: '.dev-captures/bms',
    });
  });

  it('reads the BMS, protocol and delivery settings', () => {
    expect(
      readerConfig({
        BMS_NAME: 'JK_B2A8S',
        BMS_ID: 'a1b2c3',
        BMS_PROTOCOL: 'jk02_24s',
        BMS_INGEST_URL: 'http://192.168.1.10:3000/api/bms/ingest',
        BMS_INGEST_TOKEN: 'tok',
        BMS_SEND_INTERVAL_MS: '10000',
        DEV_CAPTURE_DIR: '/tmp/captures',
      }),
    ).toEqual({
      name: 'JK_B2A8S',
      id: 'a1b2c3',
      protocol: 'JK02_24S',
      ingest: { url: 'http://192.168.1.10:3000/api/bms/ingest', token: 'tok' },
      sendIntervalMs: 10000,
      captureDir: '/tmp/captures/bms',
    });
  });

  it('needs the token whenever the ingest URL is set', () => {
    expect(() =>
      readerConfig({ BMS_INGEST_URL: 'http://x/api/bms/ingest' }),
    ).toThrow(/BMS_INGEST_TOKEN/);
  });

  it('refuses an unknown protocol', () => {
    expect(() => readerConfig({ BMS_PROTOCOL: 'JK05' })).toThrow(
      /BMS_PROTOCOL/,
    );
  });
});
