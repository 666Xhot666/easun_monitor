import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import axios, { clearAccessToken, getAccessToken, setAccessToken } from './apiClient';

describe('apiClient', () => {
  let restore = () => {};

  beforeEach(() => {
    clearAccessToken();
    localStorage.clear();
  });

  afterEach(() => restore());

  it('sends the access token as a bearer header without storing it in the browser', async () => {
    const server = fakeServer(() => ({ status: 200, data: {} }));
    restore = server.restore;
    const { sent } = server;
    setAccessToken('token-1');

    await axios.get('/api/inverter/profiles');

    expect(sent[0].headers.get('Authorization')).toBe('Bearer token-1');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    const server = fakeServer((config) => {
      if (config.url === '/api/auth/refresh') return { status: 200, data: { accessToken: 'token-2' } };
      return config.headers.get('Authorization') === 'Bearer token-2'
        ? { status: 200, data: 'ok' }
        : { status: 401 };
    });
    restore = server.restore;
    const { sent } = server;
    setAccessToken('expired');

    const [a, b] = await Promise.all([axios.get('/api/a'), axios.get('/api/b')]);

    expect([a.data, b.data]).toEqual(['ok', 'ok']);
    expect(sent.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1);
    expect(getAccessToken()).toBe('token-2');
  });
});
