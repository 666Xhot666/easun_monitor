import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import OutageCard from './OutageCard';
import type { ForecastWindow, OutageForecast } from './types';

// The site's time is UTC+3 until 25 October 2026.
const siteTime = (local: string) => new Date(`${local}+03:00`).toISOString();
const NOW = Date.parse(siteTime('2026-10-12T09:00:00'));

const window = (start: string, end: string, over: Partial<ForecastWindow> = {}): ForecastWindow => ({
  start: siteTime(start),
  end: siteTime(end),
  status: 'off',
  source: 'schedule',
  description: null,
  ...over,
});
const morning = window('2026-10-12T08:00:00', '2026-10-12T12:00:00');
const evening = window('2026-10-12T18:00:00', '2026-10-12T20:00:00', { status: 'possible' });
const tomorrow = window('2026-10-13T00:00:00', '2026-10-13T02:00:00', { source: 'weekly' });

const forecast = (over: Partial<OutageForecast> = {}): OutageForecast => ({
  state: 'fresh',
  groups: ['GPV5.2'],
  lastOkAt: siteTime('2026-10-12T08:35:00'),
  dataAgeMinutes: 25,
  lastCheck: { checkedAt: siteTime('2026-10-12T08:35:00'), outcome: 'OK', error: null },
  windows: [morning, evening, tomorrow],
  now: { status: 'off', window: morning },
  next: evening,
  ...over,
});

function renderCard(data: OutageForecast, refresh: Reply = { status: 202, data: {} }) {
  const server = fakeServer((config) => (config.method === 'post' ? refresh : { status: 200, data }));
  render(<OutageCard profileId={7} now={NOW} />);
  return server;
}

describe('OutageCard', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('says whether power is scheduled off now, and lists what comes', async () => {
    const server = renderCard(forecast());
    restore = server.restore;

    const card = await screen.findByRole('region', { name: 'Outage schedule' });
    expect(server.sent[0].url).toBe('/api/inverter/profiles/7/outage-forecast');
    expect(card).toHaveTextContent('Group 5.2');
    expect(screen.getByText('Power off until 12:00')).toBeInTheDocument();
    expect(card).toHaveTextContent('Confirmed schedule');

    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Today 08:00–12:00Off · confirmed',
      'Today 18:00–20:00Possible · confirmed',
      'Tomorrow 00:00–02:00Off · weekly pattern',
    ]);
    expect(card).toHaveTextContent('Checked 25 min ago');
  });

  it('says power is on, and names a repair on the house', async () => {
    const repair = window('2026-10-12T13:00:00', '2026-10-12T17:00:00', {
      source: 'repair',
      description: 'Аварійні ремонтні роботи',
    });
    restore = renderCard(forecast({ windows: [repair], now: { status: 'on', window: null }, next: repair })).restore;

    expect(await screen.findByText('Power on by the schedule')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Today 13:00–17:00Off · Аварійні ремонтні роботи');
  });

  it('says so when nothing is scheduled', async () => {
    restore = renderCard(forecast({ windows: [], now: { status: 'on', window: null }, next: null })).restore;
    expect(await screen.findByText('No outages scheduled for today or tomorrow.')).toBeInTheDocument();
  });

  it('warns plainly when the data is stale, with why the checks fail', async () => {
    restore = renderCard(
      forecast({
        state: 'stale',
        lastOkAt: siteTime('2026-10-11T19:00:00'),
        lastCheck: { checkedAt: siteTime('2026-10-12T08:35:00'), outcome: 'CHALLENGE', error: 'firewall' },
      }),
    ).restore;

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('No successful check for 14 h: the site blocked the reader. The schedule may have changed.');
  });

  it('says the schedule is not known before the first successful check', async () => {
    restore = renderCard(
      forecast({
        state: 'stale',
        lastOkAt: null,
        windows: [],
        now: { status: 'unknown', window: null },
        next: null,
        lastCheck: { checkedAt: siteTime('2026-10-12T08:35:00'), outcome: 'SERVER', error: 'HTTP 502' },
      }),
    ).restore;

    expect(await screen.findByText('Schedule not known yet')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No successful check yet: the site was down.');
  });

  it.each([
    ['disabled', 'Switched off in Settings.'],
    ['pending', 'The reader looks the house up on its next check.'],
    ['not-found', 'The house is not on the outage site. Check the address in Settings.'],
    ['no-groups', 'The outage site lists no outage group for this house.'],
  ] as const)('explains the %s state', async (state, text) => {
    restore = renderCard(forecast({ state, windows: [], now: { status: 'unknown', window: null }, next: null })).restore;
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('is not shown when no address is set', async () => {
    const server = renderCard(forecast({ state: 'none', groups: [], windows: [] }));
    restore = server.restore;
    await new Promise((r) => setTimeout(r, 20));
    expect(server.sent).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Outage schedule' })).not.toBeInTheDocument();
  });

  it('asks the reader for a check now', async () => {
    const server = renderCard(forecast());
    restore = server.restore;

    await userEvent.click(await screen.findByRole('button', { name: 'Check now' }));

    expect(server.sent.find((c) => c.method === 'post')?.url).toBe('/api/inverter/profiles/7/outage-source/refresh');
    expect(await screen.findByText('The reader checks within a minute.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
  });

  it('says why a check cannot be made now', async () => {
    restore = renderCard(forecast(), { status: 429, data: { message: 'Checked 2 min ago; try again in 3 min' } }).restore;
    await userEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Checked 2 min ago; try again in 3 min')).toBeInTheDocument();
  });

  it('offers no check while switched off', async () => {
    restore = renderCard(forecast({ state: 'disabled', windows: [], now: { status: 'unknown', window: null }, next: null })).restore;
    await screen.findByText('Switched off in Settings.');
    expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument();
  });
});
