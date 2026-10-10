import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { dayRange, shiftDay } from '../readings/days';
import { fakeServer } from '../test/fakeServer';
import DailyEnergy from './DailyEnergy';

const TODAY = '2026-10-07';

const totals = (pvKWh: number, gridKWh: number, outputKWh: number, batteryDischargeKWh: number) => ({
  pvKWh, gridKWh, outputKWh, batteryChargeKWh: 0, batteryDischargeKWh, coveredSeconds: 86400,
});

describe('DailyEnergy', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('asks for one total per day of the last 7 days and sums them', async () => {
    const server = fakeServer((config) =>
      config.params.from === dayRange(TODAY).from ? { status: 200, data: totals(11.1, 1.3, 10.7, 3) } : { status: 200, data: totals(10, 2, 12, 2) },
    );
    restore = server.restore;

    render(<DailyEnergy profileId={7} today={TODAY} />);

    const solar = await screen.findByRole('group', { name: 'Solar' });
    expect(await within(solar).findByText('71.1 kWh')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Grid' })).getByText('13.3 kWh')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Load' })).getByText('82.7 kWh')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Self-sufficiency' })).getByText('84%')).toBeInTheDocument();

    const froms = server.sent.map((c) => c.params.from).sort();
    expect(froms).toEqual(Array.from({ length: 7 }, (_, i) => dayRange(shiftDay(TODAY, -i)).from).sort());
  });

  it('shows where each day’s load came from, today selected first', async () => {
    restore = fakeServer(() => ({ status: 200, data: totals(11.1, 1.3, 10.7, 3) })).restore;
    const user = userEvent.setup();

    render(<DailyEnergy profileId={7} today={TODAY} />);

    const bars = await screen.findAllByRole('button', { name: /kWh load/ });
    expect(bars).toHaveLength(7);
    expect(bars[6]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('7 Oct', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('Solar direct').nextSibling).toHaveTextContent('6.4 kWh');
    expect(screen.getByText('From battery').nextSibling).toHaveTextContent('3.0 kWh');
    expect(screen.getByText('From grid').nextSibling).toHaveTextContent('1.3 kWh');

    await user.click(bars[0]);
    expect(bars[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 Oct', { selector: 'b' })).toBeInTheDocument();
  });

  it('switches to 30 days and steps back a period', async () => {
    const server = fakeServer(() => ({ status: 200, data: totals(1, 0, 1, 0) }));
    restore = server.restore;
    const user = userEvent.setup();

    render(<DailyEnergy profileId={7} today={TODAY} />);
    await screen.findAllByRole('button', { name: /kWh load/ });

    await user.click(screen.getByRole('radio', { name: '30 days' }));
    expect(await screen.findAllByRole('button', { name: /kWh load/ })).toHaveLength(30);
    expect(screen.getByText('8 Sep – 7 Oct 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(await screen.findByText('9 Aug – 7 Sep 2026')).toBeInTheDocument();
  });
});
