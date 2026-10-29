import { describe, expect, it } from 'vitest';
import { inverterApi, type HttpClient } from './api';

/** An HTTP client that records each call and answers with `data`. */
function recorder(data: unknown = { ok: true }) {
  const calls: { method: string; url: string; arg?: unknown }[] = [];
  const http: HttpClient = {
    get: async <T>(url: string, config?: unknown) => {
      calls.push({ method: 'get', url, arg: config });
      return { data: data as T };
    },
    patch: async <T>(url: string, body?: unknown) => {
      calls.push({ method: 'patch', url, arg: body });
      return { data: data as T };
    },
  };
  return { http, calls };
}

describe('inverterApi', () => {
  it('asks for the latest reading, in a language only when given one', async () => {
    const { http, calls } = recorder({ id: 1 });
    const api = inverterApi(http);
    expect(await api.latest(7)).toEqual({ id: 1 });
    await api.latest(7, 'uk');
    expect(calls).toEqual([
      { method: 'get', url: '/api/inverter/7/latest', arg: undefined },
      { method: 'get', url: '/api/inverter/7/latest', arg: { params: { lang: 'uk' } } },
    ]);
  });

  it('asks for history by common readings, with points only when given', async () => {
    const { http, calls } = recorder();
    const api = inverterApi(http);
    await api.history(7, { from: 'a', to: 'b', readings: ['pvPower', 'batteryPower'] });
    await api.history(7, { from: 'a', to: 'b', readings: ['pvPower'], points: 288 });
    expect(calls.map((c) => c.arg)).toEqual([
      { params: { from: 'a', to: 'b', readings: 'pvPower,batteryPower' } },
      { params: { from: 'a', to: 'b', readings: 'pvPower', points: 288 } },
    ]);
    expect(calls[0].url).toBe('/api/inverter/7/history');
  });

  it('asks for energy totals, the signed-in user, and saves profile changes', async () => {
    const { http, calls } = recorder();
    const api = inverterApi(http);
    await api.energy(7, { from: 'a', to: 'b' });
    await api.me();
    await api.updateProfile(7, { writesLocked: true });
    expect(calls).toEqual([
      { method: 'get', url: '/api/inverter/7/energy', arg: { params: { from: 'a', to: 'b' } } },
      { method: 'get', url: '/api/auth/me', arg: undefined },
      { method: 'patch', url: '/api/inverter/profiles/7', arg: { writesLocked: true } },
    ]);
  });
});
