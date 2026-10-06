import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import { dayRange } from '../readings/days';
import EnergyTotals from './EnergyTotals';

const TODAY = '2026-10-06';
const YESTERDAY = '2026-10-05';
/** Noon today, local time: half of today has passed. */
const NOON = () => new Date(`${TODAY}T12:00:00`).getTime();

const totals = (
  pvKWh: number,
  gridKWh: number,
  outputKWh: number,
  coveredSeconds: number,
  batteryChargeKWh = 0,
  batteryDischargeKWh = 0,
) => ({
  status: 200,
  data: { pvKWh, gridKWh, outputKWh, batteryChargeKWh, batteryDischargeKWh, coveredSeconds },
});

describe('EnergyTotals', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("shows today's and yesterday's PV, grid and load energy", async () => {
    const server = fakeServer((config) =>
      config.params.from === dayRange(TODAY).from ? totals(3.456, 0.8, 4.1, 12 * 3600, 1.44, 0.99) : totals(12.34, 2, 15.5, 24 * 3600),
    );
    restore = server.restore;

    render(<EnergyTotals profileId={7} today={TODAY} now={NOON} />);

    const table = await screen.findByRole('table', { name: 'Energy' });
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(`^${name}`) });
    expect(await within(row('PV')).findByText('3.46 kWh')).toBeInTheDocument();
    expect(within(row('PV')).getByText('12.3 kWh')).toBeInTheDocument();
    expect(within(row('Grid')).getByText('0.80 kWh')).toBeInTheDocument();
    expect(within(row('Load')).getByText('15.5 kWh')).toBeInTheDocument();
    expect(within(row('Battery charge')).getByText('1.44 kWh')).toBeInTheDocument();
    expect(within(row('Battery discharge')).getByText('0.99 kWh')).toBeInTheDocument();

    expect(server.sent.map((c) => c.url)).toEqual(['/api/inverter/7/energy', '/api/inverter/7/energy']);
    expect(server.sent.map((c) => c.params.from).sort()).toEqual([dayRange(TODAY).from, dayRange(YESTERDAY).from].sort());
    expect(screen.queryByText(/Data for/)).not.toBeInTheDocument();
  });

  it('says how much of a day the totals cover when readings are missing', async () => {
    restore = fakeServer((config) =>
      config.params.from === dayRange(TODAY).from ? totals(1, 0, 1, 6 * 3600) : totals(1, 0, 1, 18 * 3600),
    ).restore;

    render(<EnergyTotals profileId={7} today={TODAY} now={NOON} />);

    expect(await screen.findByText('Data for 50% of today so far')).toBeInTheDocument();
    expect(screen.getByText('Data for 75% of yesterday')).toBeInTheDocument();
  });

  it('shows dashes when the totals cannot be loaded', async () => {
    restore = fakeServer(() => ({ status: 500 })).restore;

    render(<EnergyTotals profileId={7} today={TODAY} now={NOON} />);

    const table = await screen.findByRole('table', { name: 'Energy' });
    await within(table).findAllByText('--');
    expect(within(table).getAllByText('--')).toHaveLength(10);
  });
});
