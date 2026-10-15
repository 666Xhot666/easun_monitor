import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { TelemetryStore } from '../src/telemetry/telemetry.store';
import { createTestApp, registerUser, resetDatabase, sampleProfile } from './helpers';

describe('Register metadata and decoded alerts (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
  });

  afterAll(() => app.close());

  it('serves the register map to signed-in users', async () => {
    await request(app.getHttpServer()).get('/api/inverter/registers').expect(401);

    const res = await request(app.getHttpServer())
      .get('/api/inverter/registers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const byName = Object.fromEntries(res.body.map((d: { name: string }) => [d.name, d]));
    expect(byName.MainsVoltage).toMatchObject({ label: 'Mains voltage', unit: 'V', group: 'telemetry', scale: 0.1 });
    expect(byName.OutputPriority).toMatchObject({ group: 'settings', writable: true });
    expect(byName.OutputPriority.options).toHaveLength(4);
  });

  it('lists the settings that exist only on the inverter panel', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/inverter/panel-settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const byProgram = Object.fromEntries(res.body.map((s: { program: string }) => [s.program, s]));
    expect(res.body.map((s: { program: string }) => s.program)).toEqual(['10', '13', '25', '32', '39', '41', '42', '46']);
    expect(byProgram['10']).toMatchObject({ title: 'Auto bypass', default: 'Manual' });
  });

  it('serves the register texts and panel settings in Ukrainian when asked, English for anything else', async () => {
    const get = (path: string) =>
      request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`).expect(200);

    const uk = Object.fromEntries((await get('/api/inverter/registers?lang=uk')).body.map((d: { name: string }) => [d.name, d]));
    expect(uk.MainsVoltage).toMatchObject({ label: 'Напруга мережі', unit: 'В', scale: 0.1 });
    expect(uk.OutputPriority.options[2]).toBe('Сонце-акумулятор-мережа (SBU)');
    expect((await get('/api/inverter/registers?lang=ru')).body[0].label).toBe('Faults');

    const panel = (await get('/api/inverter/panel-settings?lang=uk')).body;
    expect(panel[0]).toMatchObject({ program: '10', title: 'Автоматичний байпас', default: 'Вручну' });
  });

  it('adds the active faults and warnings to the latest reading', async () => {
    const { id } = (
      await request(app.getHttpServer())
        .post('/api/inverter/setup')
        .set('Authorization', `Bearer ${token}`)
        .send(sampleProfile)
        .expect(201)
    ).body;
    await app.get(TelemetryStore).record(id, { MainsVoltage: 230, FaultCode: 1 << 7, WarningCode: (1 << 8) | (1 << 14) });

    const res = await request(app.getHttpServer())
      .get(`/api/inverter/${id}/latest`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.alerts).toEqual({
      faults: ['Output overload'],
      warnings: ['Battery low voltage', 'Fan blocked'],
    });

    const uk = await request(app.getHttpServer())
      .get(`/api/inverter/${id}/latest`)
      .query({ lang: 'uk' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(uk.body.alerts).toEqual({
      faults: ['Перевантаження виходу'],
      warnings: ['Низька напруга акумулятора', 'Вентилятор заблоковано'],
    });
  });
});
