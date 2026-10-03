import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SERIAL_TAP_FACTORY } from '../src/inverter/serial-sniff/serial-sniff.module';
import type { SerialTap } from '../src/inverter/serial-sniff/serial-sniffer';
import { createTestApp, registerUser, resetDatabase } from './helpers';

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

describe('Dev serial sniff (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const taps: { path: string; tap: FakeTap }[] = [];
  const env = { NODE_ENV: process.env.NODE_ENV, DEV_SERIAL_SNIFF: process.env.DEV_SERIAL_SNIFF };

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(SERIAL_TAP_FACTORY).useValue(async (path: string) => {
        const tap = new FakeTap();
        taps.push({ path, tap });
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
    await call('post', '/api/dev/serial/stop');
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  });

  afterAll(() => app.close());

  const call = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);

  it('captures frames from the port and serves them by sequence number', async () => {
    const started = await call('post', '/api/dev/serial/start').send({ path: '/dev/cu.usbserial-1' }).expect(201);
    expect(started.body).toMatchObject({ running: true, path: '/dev/cu.usbserial-1' });

    taps[taps.length - 1].tap.receive('01 03 02 08 fc bf c5 01 03 04 00 14 00 32 3b e2');

    const all = await call('get', '/api/dev/serial?since=0').expect(200);
    expect(all.body.frames.map((f: { seq: number; words: number[] }) => [f.seq, f.words])).toEqual([
      [1, [2300]],
      [2, [20, 50]],
    ]);
    const newer = await call('get', '/api/dev/serial?since=1').expect(200);
    expect(newer.body.frames).toHaveLength(1);

    await call('post', '/api/dev/serial/frames/1/note').send({ note: 'output voltage 230 V' }).expect(204);
    await call('post', '/api/dev/serial/frames/99/note').send({ note: 'x' }).expect(404);
    const noted = await call('get', '/api/dev/serial?since=0').expect(200);
    expect(noted.body.frames[0].note).toBe('output voltage 230 V');

    const stopped = await call('post', '/api/dev/serial/stop').expect(201);
    expect(stopped.body.running).toBe(false);
  });

  it('offers the configured port path', async () => {
    process.env.SERIAL_PORT = '/dev/cu.usbserial-XYZ';
    try {
      const res = await call('get', '/api/dev/serial?since=0').expect(200);
      expect(res.body.defaultPath).toBe('/dev/cu.usbserial-XYZ');
    } finally {
      delete process.env.SERIAL_PORT;
    }
  });

  it('requires a signed-in user', async () => {
    await request(app.getHttpServer()).get('/api/dev/serial?since=0').expect(401);
  });

  it('does not exist unless opted in, nor in production', async () => {
    delete process.env.DEV_SERIAL_SNIFF;
    await call('get', '/api/dev/serial?since=0').expect(404);
    process.env.DEV_SERIAL_SNIFF = 'true';
    process.env.NODE_ENV = 'production';
    await call('post', '/api/dev/serial/start').send({ path: '/dev/cu.x' }).expect(404);
  });
});
