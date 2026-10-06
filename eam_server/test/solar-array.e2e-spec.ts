import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
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

describe('Solar array on the inverter profile (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let strangerToken: string;
  let profileId: number;
  let panelTypeId: number;
  let strangersPanelTypeId: number;

  // Users are made once: registration is rate-limited.
  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    token = await registerUser(app, 'owner@example.com');
    strangerToken = await registerUser(app, 'stranger@example.com');
    profileId = (
      await call('post', '/api/inverter/setup').send(sampleProfile).expect(201)
    ).body.id;
    panelTypeId = (
      await call('post', '/api/panel-types').send(longi).expect(201)
    ).body.id;
    strangersPanelTypeId = (
      await call('post', '/api/panel-types', strangerToken)
        .send(longi)
        .expect(201)
    ).body.id;
  });

  afterAll(() => app.close());

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    auth = token,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${auth}`);

  const array = { pvPanelTypeId: 0, pvPanelsInSeries: 3, pvStrings: 2 };
  const limits = {
    pvMaxVocV: 500,
    pvMpptMinV: 60,
    pvMpptMaxV: 450,
    pvMaxPowerW: 4000,
    pvMaxCurrentA: 22,
  };

  it('stores the array wiring and the PV input limits, and shows them with the profile', async () => {
    const { body } = await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ ...array, pvPanelTypeId: panelTypeId, ...limits })
      .expect(200);
    expect(body).toMatchObject({
      ...array,
      pvPanelTypeId: panelTypeId,
      ...limits,
    });

    const me = await call('get', '/api/auth/me').expect(200);
    expect(me.body.inverterProfiles[0]).toMatchObject({
      ...array,
      pvPanelTypeId: panelTypeId,
      ...limits,
    });
  });

  it('clears the array and limits with null', async () => {
    const { body } = await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({
        pvPanelTypeId: null,
        pvPanelsInSeries: null,
        pvStrings: null,
        pvMaxVocV: null,
      })
      .expect(200);
    expect(body).toMatchObject({
      pvPanelTypeId: null,
      pvPanelsInSeries: null,
      pvStrings: null,
      pvMaxVocV: null,
    });
  });

  it("refuses another user's panel type and impossible wiring", async () => {
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ pvPanelTypeId: strangersPanelTypeId })
      .expect(400);
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ pvPanelsInSeries: 0 })
      .expect(400);
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ pvStrings: 1.5 })
      .expect(400);
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ pvMpptMinV: -1 })
      .expect(400);
  });

  it('refuses to delete a panel type an inverter uses', async () => {
    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ pvPanelTypeId: panelTypeId })
      .expect(200);

    await call('delete', `/api/panel-types/${panelTypeId}`).expect(409);

    await call('patch', `/api/inverter/profiles/${profileId}`)
      .send({ pvPanelTypeId: null })
      .expect(200);
    await call('delete', `/api/panel-types/${panelTypeId}`).expect(200);
  });
});
