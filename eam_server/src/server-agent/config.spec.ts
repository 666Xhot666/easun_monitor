import { serverAgentConfig } from './config';

const base = {
  SERVER_AGENT_URL: 'http://localhost:3000',
  SERVER_AGENT_TOKEN: 't',
};

describe('serverAgentConfig', () => {
  it('needs the server and the token, and has defaults for the rest', () => {
    expect(serverAgentConfig(base)).toEqual({
      server: { url: 'http://localhost:3000', token: 't' },
      intervalSeconds: 60,
      services: [
        'easun-serial-logger',
        'easun-bms-reader',
        'easun-outage-reader',
      ],
    });
    expect(() => serverAgentConfig({ ...base, SERVER_AGENT_URL: '' })).toThrow(
      /SERVER_AGENT_URL/,
    );
    expect(() =>
      serverAgentConfig({ ...base, SERVER_AGENT_TOKEN: ' ' }),
    ).toThrow(/SERVER_AGENT_TOKEN/);
  });

  it('takes the interval and the services to watch', () => {
    const config = serverAgentConfig({
      ...base,
      SERVER_AGENT_INTERVAL_SECONDS: '30',
      SERVER_AGENT_SERVICES: ' a , b,,',
    });
    expect(config.intervalSeconds).toBe(30);
    expect(config.services).toEqual(['a', 'b']);
    expect(
      serverAgentConfig({ ...base, SERVER_AGENT_SERVICES: 'none' }).services,
    ).toEqual([]);
    expect(() =>
      serverAgentConfig({ ...base, SERVER_AGENT_INTERVAL_SECONDS: '5' }),
    ).toThrow(/at least 10/);
  });
});
