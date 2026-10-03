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
    expect(res.body.map((s: { program: string }) => s.program)).toEqual(['03', '05', '10', '13', '25', '32', '39', '41', '42', '46']);
    expect(byProgram['05']).toMatchObject({
      title: 'Battery type',
      default: 'AGM',
      options: ['AGM', 'Flooded', 'User-Defined', 'Lithium without communication'],
    });
    expect(byProgram['05'].affects).toEqual(
      expect.arrayContaining(['MaxChargingVoltage', 'BatteryEqModeEnabled']),
    );
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
  });
});
