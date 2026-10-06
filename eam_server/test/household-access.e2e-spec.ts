import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  sampleProfile,
} from './helpers';

const longi = {
  name: 'Longi 450W',
  maxPowerW: 450,
  vmpV: 41.5,
  impA: 10.85,
  vocV: 49.5,
  iscA: 11.5,
};
const day = 'from=2026-10-06T00:00:00.000Z&to=2026-10-07T00:00:00.000Z';

type Method = 'get' | 'post' | 'patch' | 'delete';

describe('Household access: admin, reader, stranger (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tokens: Record<'admin' | 'reader' | 'stranger', string> = {
    admin: '',
    reader: '',
    stranger: '',
  };
  let profileId: number;
  let bmsId: number;
  let panelTypeId: number;

  // Users are made once: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(app);
    tokens.admin = await registerUser(app, 'admin@example.com');
    tokens.reader = await registerUser(app, 'reader@example.com');
    tokens.stranger = await registerUser(app, 'stranger@example.com');

    profileId = (
      await call('admin', 'post', '/api/inverter/setup')
        .send(sampleProfile)
        .expect(201)
    ).body.id;
    panelTypeId = (
      await call('admin', 'post', '/api/panel-types').send(longi).expect(201)
    ).body.id;
    bmsId = (
      await call('admin', 'post', `/api/inverter/profiles/${profileId}/bms`)
        .send({ name: 'Pack', sourceType: 'mac-ble' })
        .expect(201)
    ).body.device.id;
    await prisma.inverterLog.create({
      data: { inverterProfileId: profileId, payload: { PVPower: 100 } },
    });
    await prisma.bmsLog.create({
      data: {
        bmsDeviceId: bmsId,
        timestamp: new Date(),
        payload: { stateOfChargePct: 90 },
      },
    });

    // The reader joins the admin's household (invites come in a later slice).
    const reader = await prisma.user.findUniqueOrThrow({
      where: { email: 'reader@example.com' },
    });
    const { householdId } = await prisma.inverterProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    await prisma.membership.create({
      data: { userId: reader.id, householdId: householdId!, role: 'READER' },
    });
  });

  afterAll(() => app.close());

  const call = (who: keyof typeof tokens, method: Method, path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${tokens[who]}`);

  const reads = (): [Method, string][] => [
    ['get', `/api/inverter/profiles/${profileId}`],
    ['get', `/api/inverter/${profileId}/latest`],
    ['get', `/api/inverter/${profileId}/status`],
    ['get', `/api/inverter/${profileId}/history`],
    ['get', `/api/inverter/${profileId}/readings?${day}`],
    ['get', `/api/inverter/${profileId}/energy?${day}`],
    ['get', `/api/inverter/${profileId}/readings/export?${day}`],
    ['get', `/api/inverter/${profileId}/settings`],
    ['get', `/api/inverter/${profileId}/settings/constraints`],
    ['get', `/api/inverter/${profileId}/settings/history`],
    ['post', `/api/inverter/${profileId}/settings/refresh`],
    ['get', `/api/inverter/profiles/${profileId}/bms`],
    ['get', `/api/inverter/profiles/${profileId}/bms/${bmsId}/latest`],
    ['get', `/api/inverter/profiles/${profileId}/bms/${bmsId}/history`],
    ['get', `/api/inverter/profiles/${profileId}/bms/${bmsId}/export?${day}`],
  ];

  /** Valid bodies, so a refusal can only come from the access check. */
  const writes = (): [Method, string, object?][] => [
    ['patch', `/api/inverter/profiles/${profileId}`, { name: 'Renamed' }],
    [
      'patch',
      `/api/inverter/${profileId}/settings`,
      { changes: { OutputPriority: 2 } },
    ],
    ['post', `/api/inverter/${profileId}/exit-fault-mode`],
    [
      'post',
      `/api/inverter/profiles/${profileId}/bms`,
      { name: 'Another', sourceType: 'esp32' },
    ],
    [
      'patch',
      `/api/inverter/profiles/${profileId}/bms/${bmsId}`,
      { useForEnergyFlow: true },
    ],
    ['post', `/api/inverter/profiles/${profileId}/bms/${bmsId}/token`],
    [
      'patch',
      `/api/panel-types/${panelTypeId}`,
      { ...longi, name: 'Renamed panel' },
    ],
    ['delete', `/api/inverter/profiles/${profileId}/bms/${bmsId}`],
    ['delete', `/api/panel-types/${panelTypeId}`],
    ['delete', `/api/inverter/profiles/${profileId}`],
  ];

  it('lets a reader read everything of the household', async () => {
    const refused: string[] = [];
    for (const [method, path] of reads()) {
      const { status } = await call('reader', method, path);
      if ([401, 403, 404].includes(status))
        refused.push(`${method} ${path} -> ${status}`);
    }
    expect(refused).toEqual([]);
    const profiles = await call(
      'reader',
      'get',
      '/api/inverter/profiles',
    ).expect(200);
    expect(profiles.body.map((p: { id: number }) => p.id)).toContain(profileId);
    const panelTypes = await call('reader', 'get', '/api/panel-types').expect(
      200,
    );
    expect(panelTypes.body.map((t: { id: number }) => t.id)).toContain(
      panelTypeId,
    );
  });

  it('refuses every write to a reader', async () => {
    for (const [method, path, body] of writes()) {
      const { status } = await call('reader', method, path).send(body);
      expect({ method, path, status }).toEqual({ method, path, status: 403 });
    }
  });

  it('hides the household from a stranger, reads and writes alike', async () => {
    for (const [method, path, body] of [...reads(), ...writes()]) {
      const { status } = await call('stranger', method, path).send(body);
      expect({ method, path, status }).toEqual({ method, path, status: 404 });
    }
    const profiles = await call(
      'stranger',
      'get',
      '/api/inverter/profiles',
    ).expect(200);
    expect(profiles.body).toEqual([]);
    const panelTypes = await call('stranger', 'get', '/api/panel-types').expect(
      200,
    );
    expect(panelTypes.body).toEqual([]);
  });

  it('lets the admin write (last, as it deletes)', async () => {
    const refused: string[] = [];
    for (const [method, path, body] of writes()) {
      const { status } = await call('admin', method, path).send(body);
      if ([401, 403, 404].includes(status))
        refused.push(`${method} ${path} -> ${status}`);
    }
    expect(refused).toEqual([]);
  });
});
