import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import FanPanel from './FanPanel';
import type { FanStatus } from './FanPanel';

const status = (over: Partial<FanStatus> = {}): FanStatus => ({
  settings: { mode: 'AUTO', minPercent: 0, manualPercent: 100, rules: [{ aboveC: 80, percent: 100 }] },
  state: { mode: 'manual', percent: 30, pwm: 128, steps: 3, error: null },
  ...over,
});

function renderPanel(data: FanStatus, owner = true) {
  const server = fakeServer((config) =>
    config.method === 'put' ? { status: 200, data: JSON.parse(config.data) } : { status: 200, data },
  );
  render(<FanPanel owner={owner} />);
  return server;
}

const put = (server: ReturnType<typeof renderPanel>) => JSON.parse(server.sent.find((c) => c.method === 'put')?.data);

describe('FanPanel', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('says what the fan is doing now', async () => {
    restore = renderPanel(status()).restore;
    expect(await screen.findByText('Now: 30 % (low)')).toBeInTheDocument();
  });

  it("shows the agent's trouble setting the fan", async () => {
    restore = renderPanel(status({ state: { mode: 'firmware', percent: null, pwm: null, steps: 3, error: 'EACCES: permission denied' } })).restore;
    expect(await screen.findByText('Now: run by the firmware')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The agent could not set the fan: EACCES: permission denied');
  });

  it('shows a viewer the settings without letting them change anything', async () => {
    restore = renderPanel(status(), false).restore;
    expect(await screen.findByText('Above 80 °C: 100 % (high)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Fan mode' })).not.toBeInTheDocument();
  });

  it('sets a fixed speed, saying which speed it gives', async () => {
    const server = renderPanel(status());
    restore = server.restore;
    await userEvent.click(await screen.findByRole('radio', { name: 'Manual' }));
    const speed = screen.getByRole('spinbutton', { name: 'Speed (%)' });
    await userEvent.clear(speed);
    await userEvent.type(speed, '30');
    expect(screen.getByText('→ low')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(put(server)).toEqual({ mode: 'MANUAL', minPercent: 0, manualPercent: 30, rules: [{ aboveC: 80, percent: 100 }] });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('edits the rules, keeping them in order of temperature', async () => {
    const server = renderPanel(status());
    restore = server.restore;
    const table = await screen.findByRole('table', { name: 'Rules' });

    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    const rows = within(table).getAllByRole('row').slice(1);
    const last = rows[rows.length - 1];
    const temp = within(last).getByRole('spinbutton', { name: 'Above (°C)' });
    const pct = within(last).getByRole('spinbutton', { name: 'Speed (%)' });
    await userEvent.clear(temp);
    await userEvent.type(temp, '40');
    await userEvent.clear(pct);
    await userEvent.type(pct, '20');
    await userEvent.tab();

    // Sorted once the temperature is left.
    const temps = within(table).getAllByRole('spinbutton', { name: 'Above (°C)' }).map((i) => (i as HTMLInputElement).value);
    expect(temps).toEqual(['40', '80']);

    const minimum = screen.getByRole('spinbutton', { name: 'Minimum speed (%)' });
    await userEvent.clear(minimum);
    await userEvent.type(minimum, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(put(server)).toEqual({
      mode: 'AUTO',
      minPercent: 10,
      manualPercent: 100,
      rules: [
        { aboveC: 40, percent: 20 },
        { aboveC: 80, percent: 100 },
      ],
    });
  });

  it('removes a rule', async () => {
    const server = renderPanel(status({ settings: { mode: 'AUTO', minPercent: 0, manualPercent: 100, rules: [{ aboveC: 60, percent: 30 }, { aboveC: 80, percent: 100 }] } }));
    restore = server.restore;
    await userEvent.click(await screen.findByRole('button', { name: 'Remove the rule above 60 °C' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(put(server).rules).toEqual([{ aboveC: 80, percent: 100 }]);
  });

  it("shows the server's reason when it refuses", async () => {
    const server = fakeServer((config) =>
      config.method === 'put' ? { status: 400, data: { message: 'Two rules have the same temperature' } } : { status: 200, data: status() },
    );
    restore = server.restore;
    render(<FanPanel owner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Two rules have the same temperature');
  });
});
