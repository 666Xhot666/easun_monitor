import { INestApplication } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import type { SerialTap } from '../src/inverter/serial-sniff/serial-capture';
import { SERIAL_TAP_FACTORY } from '../src/inverter/serial-sniff/serial-sniff.module';
import { createTestApp, registerUser, resetDatabase } from './helpers';

const READ_301 = '01 03 01 2d 00 01 15 ff'; // request: read register 301
const VALUE_2 = '01 03 02 00 02 39 85'; // response: one register = 2

class FakeTap implements SerialTap {
  private data: (chunk: Buffer) => void = () => {};
  onData(listener: (chunk: Buffer) => void) {
    this.data = listener;
  }
  onError() {}
  async close() {}
  receive(hex: string) {
    this.data(Buffer.from(hex.replace(/ /g, ''), 'hex'));
  }
}

describe('Dev serial capture (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let dir: string;
  const taps = new Map<string, FakeTap>();
  const saved = { ...process.env };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dev-captures-'));
    process.env.DEV_CAPTURE_DIR = dir;
    app = await createTestApp((builder) =>
      builder.overrideProvider(SERIAL_TAP_FACTORY).useValue(async (path: string) => {
        const tap = new FakeTap();
        taps.set(path, tap);
        return tap;
      }),
    );
  });

  beforeEach(async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SERIAL_SNIFF = 'true';
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
  });

  afterEach(async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SERIAL_SNIFF = 'true';
    await call('post', '/api/dev/serial/stop');
    for (const key of ['NODE_ENV', 'DEV_SERIAL_SNIFF', 'SERIAL_RX_PORT', 'SERIAL_TX_BAUD']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const call = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);

  it('captures paired reads and summarises the capture afterwards', async () => {
    const started = await call('post', '/api/dev/serial/start')
      .send({ rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx', txBaud: 115200 })
      .expect(201);
    expect(started.body).toMatchObject({
      running: true,
      ports: { rx: { path: '/dev/cu.rx', baudRate: 9600, state: 'open' }, tx: { path: '/dev/cu.tx', baudRate: 115200 } },
    });

    taps.get('/dev/cu.tx')!.receive(READ_301);
    taps.get('/dev/cu.rx')!.receive(VALUE_2);

    const live = await call('get', '/api/dev/serial?since=2').expect(200);
    expect(live.body.records).toEqual([
      expect.objectContaining({ seq: 3, kind: 'pair', request: expect.objectContaining({ address: 301 }) }),
    ]);
    const captureId = live.body.captureId as string;

    await call('post', '/api/dev/serial/stop').expect(201);

    const captures = await call('get', '/api/dev/serial/captures').expect(200);
    expect(captures.body[0]).toMatchObject({ id: captureId, rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx' });

    const summary = await call('get', `/api/dev/serial/captures/${captureId}/summary`).expect(200);
    expect(summary.body.counts).toMatchObject({ pairs: 1, plausible: 1 });
    expect(summary.body.addresses).toEqual([
      expect.objectContaining({ address: 301, name: 'OutputPriority', latestValue: 2, category: 'plausible' }),
    ]);
    await call('get', '/api/dev/serial/captures/nope/summary').expect(404);
  });

  it('checks values against the ranges for a given battery voltage', async () => {
    await call('post', '/api/dev/serial/start').send({ rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx' }).expect(201);
    taps.get('/dev/cu.tx')!.receive('01 03 01 44 00 01 c5 e3'); // read 324 (bulk voltage)
    taps.get('/dev/cu.rx')!.receive('01 03 02 02 30 b9 30'); // 560 = 56.0 V
    const { captureId } = (await call('get', '/api/dev/serial?since=0').expect(200)).body;

    const summary = await call('get', `/api/dev/serial/captures/${captureId}/summary?batteryVoltage=24`).expect(200);
    expect(summary.body.addresses[0]).toMatchObject({ name: 'MaxChargingVoltage', category: 'implausible' });
  });

  it('suggests names for unknown addresses from a ground-truth snapshot', async () => {
    mkdirSync(join(dir, 'ground-truth'), { recursive: true });
    writeFileSync(
      join(dir, 'ground-truth', 'cloud-snapshot.json'),
      JSON.stringify({ capturedAt: new Date().toISOString(), source: 'vendor cloud app', fields: { inverter: 3900 } }),
    );
    await call('post', '/api/dev/serial/start').send({ rxPath: '/dev/cu.rx', txPath: '/dev/cu.tx' }).expect(201);
    taps.get('/dev/cu.tx')!.receive('01 03 02 e9 00 01 54 46'); // read 745, not in the register map
    taps.get('/dev/cu.rx')!.receive('01 03 02 0f 3c bd a5'); // 3900
    const { captureId } = (await call('get', '/api/dev/serial?since=0').expect(200)).body;

    const snapshots = await call('get', '/api/dev/serial/ground-truth').expect(200);
    expect(snapshots.body).toEqual([expect.objectContaining({ id: 'cloud-snapshot', source: 'vendor cloud app' })]);

    const summary = await call('get', `/api/dev/serial/captures/${captureId}/summary?groundTruth=cloud-snapshot`).expect(200);
    expect(summary.body.groundTruth).toMatchObject({ id: 'cloud-snapshot' });
    expect(summary.body.suggestions).toEqual([
      expect.objectContaining({ address: 745, raw: 3900, matches: [expect.objectContaining({ field: 'inverter', scale: 1 })] }),
    ]);
    await call('get', `/api/dev/serial/captures/${captureId}/summary?groundTruth=nope`).expect(404);
  });

  it('offers the configured ports and baud rates', async () => {
    process.env.SERIAL_RX_PORT = '/dev/cu.usbserial-RX';
    process.env.SERIAL_TX_BAUD = '115200';
    const res = await call('get', '/api/dev/serial?since=0').expect(200);
    expect(res.body.defaults).toEqual({ rxPath: '/dev/cu.usbserial-RX', txPath: null, rxBaud: 9600, txBaud: 115200 });
  });

  it('requires a signed-in user', async () => {
    await request(app.getHttpServer()).get('/api/dev/serial?since=0').expect(401);
  });

  it('does not exist unless opted in, nor in production', async () => {
    delete process.env.DEV_SERIAL_SNIFF;
    await call('get', '/api/dev/serial/captures').expect(404);
    process.env.DEV_SERIAL_SNIFF = 'true';
    process.env.NODE_ENV = 'production';
    await call('post', '/api/dev/serial/start').send({ rxPath: 'a', txPath: 'b' }).expect(404);
  });
});
