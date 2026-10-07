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

  it("shows today's solar, grid and load energy against yesterday, and the self-sufficiency", async () => {
    const server = fakeServer((config) =>
      config.params.from === dayRange(TODAY).from ? totals(14.2, 1.8, 11.9, 12 * 3600, 3, 2.7) : totals(12.1, 2.4, 11.5, 24 * 3600),
    );
    restore = server.restore;

    render(<EnergyTotals profileId={7} today={TODAY} now={NOON} />);

    const tile = async (name: string) => within(await screen.findByRole('group', { name }));
    expect(await (await tile('Solar')).findByText('14.2')).toBeInTheDocument();
    expect((await tile('Solar')).getByText('↑ 2.1 vs 12.1')).toBeInTheDocument();
    expect((await tile('Grid')).getByText('1.80')).toBeInTheDocument();
    expect((await tile('Grid')).getByText('↓ 0.60 vs 2.40')).toBeInTheDocument();
    expect((await tile('Load')).getByText('11.9')).toBeInTheDocument();
    expect((await tile('Self-sufficiency')).getByText('85')).toBeInTheDocument();
    expect((await tile('Self-sufficiency')).getByText('↑ 6 pts vs 79%')).toBeInTheDocument();

    const mix = screen.getByRole('img', { name: /Where today’s load came from/ });
    expect(mix).toHaveAccessibleName('Where today’s load came from: solar 62%, battery 23%, grid 15%');

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

    expect(await within(await screen.findByRole('group', { name: 'Solar' })).findByText('--')).toBeInTheDocument();
    expect(screen.getAllByText('--')).toHaveLength(4);
  });
});
