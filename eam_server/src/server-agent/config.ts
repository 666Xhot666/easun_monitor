export interface ServerAgentConfig {
  server: {
    url: string;
    token: string;
  };
  intervalSeconds: number;
  services: string[];
}

/**
 * The agent's settings from the environment.
 */
export function serverAgentConfig(
  env: Record<string, string | undefined>,
): ServerAgentConfig {
  const url = env.SERVER_AGENT_URL?.trim();
  if (!url) {
    throw new Error(
      'SERVER_AGENT_URL is required: the server the agent reports to, e.g. http://localhost:3000',
    );
  }

  const token = env.SERVER_AGENT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'SERVER_AGENT_TOKEN is required: make one in the app under Settings > Server access',
    );
  }

  const intervalRaw = env.SERVER_AGENT_INTERVAL_SECONDS;
  let intervalSeconds: number;
  if (!intervalRaw) {
    intervalSeconds = 60;
  } else {
    const parsed = Number(intervalRaw);
    if (!Number.isInteger(parsed) || parsed < 10) {
      throw new Error(
        'SERVER_AGENT_INTERVAL_SECONDS must be a whole number of at least 10',
      );
    }
    intervalSeconds = parsed;
  }

  const servicesRaw = env.SERVER_AGENT_SERVICES;
  let services: string[];
  if (servicesRaw === undefined || servicesRaw === '') {
    services = [
      'easun-serial-logger',
      'easun-bms-reader',
      'easun-outage-reader',
    ];
  } else if (servicesRaw === 'none') {
    services = [];
  } else {
    services = servicesRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return {
    server: {
      url,
      token,
    },
    intervalSeconds,
    services,
  };
}
