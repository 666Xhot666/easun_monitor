export interface ServerAgentConfig {
  server: {
    url: string;
    token: string;
  };
  intervalSeconds: number;
  services: string[];
  /** How often to check for package updates; 0: never. */
  updatesEveryHours: number;
  /** The fan to control: its hwmon name, and its fixed speeds (off included) if any. */
  fan: { name: string; steps: number | null } | null;
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
      'easun-server-agent',
    ];
  } else if (servicesRaw === 'none') {
    services = [];
  } else {
    services = servicesRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const fanName = env.SERVER_AGENT_FAN?.trim();
  const stepsRaw = env.SERVER_AGENT_FAN_STEPS?.trim();
  let steps: number | null = null;
  if (stepsRaw) {
    steps = Number(stepsRaw);
    if (!Number.isInteger(steps) || steps < 2) {
      throw new Error(
        'SERVER_AGENT_FAN_STEPS must be the number of fixed speeds, off included (at least 2)',
      );
    }
  }

  const hoursRaw = env.SERVER_AGENT_UPDATES_HOURS?.trim();
  const updatesEveryHours = hoursRaw ? Number(hoursRaw) : 6;
  if (!Number.isInteger(updatesEveryHours) || updatesEveryHours < 0) {
    throw new Error(
      'SERVER_AGENT_UPDATES_HOURS must be a whole number of hours (0: do not check)',
    );
  }

  return {
    updatesEveryHours,
    fan: fanName ? { name: fanName, steps } : null,
    server: {
      url,
      token,
    },
    intervalSeconds,
    services,
  };
}
