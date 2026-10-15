import i18n from '../i18n';

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

/** "Chrome on macOS" from a User-Agent string; the raw string when it is not a browser we know. */
export function describeUserAgent(agent: string | null): string {
  if (!agent) return i18n.t('account.unknownBrowser');
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  if (!browser || !system) return agent.slice(0, 60);
  return i18n.t('account.browserOn', { browser, system });
}
