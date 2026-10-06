import { render as renderUi, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer } from '../test/fakeServer';
import type { LatestReading } from '../inverter/types';
import PvArrayTile from './PvArrayTile';
import type { PanelType } from './pvArray';
import { dayRange } from '../readings/days';

const longi: PanelType = { id: 1, name: 'Longi 450W', maxPowerW: 450, vmpV: 41.5, impA: 10.85, vocV: 49.5, iscA: 11.5 };
const wiring = { pvPanelTypeId: 1, pvPanelsInSeries: 3, pvStrings: 2 };
const reading = (payload: Record<string, number>): LatestReading => ({ id: 1, timestamp: new Date().toISOString(), payload });
const TODAY = '2026-10-06';
const render = (ui: ReactElement) => renderUi(<MemoryRouter>{ui}</MemoryRouter>);

describe('PvArrayTile', () => {
  let restore = () => {};
  afterEach(() => restore());

  const history = (pv: number[]) =>
    fakeServer((config) =>
      config.url === '/api/inverter/7/history'
        ? { status: 200, data: { source: 'raw', bucketSeconds: 300, points: pv.map((PVPower, i) => ({ timestamp: String(i), values: { PVPower } })) } }
        : { status: 404 },
    );

  it("shows the array, how much of it is in use now, and today's peak", async () => {
    const server = history([300, 2106, 1500]);
    restore = server.restore;

    render(
      <PvArrayTile profileId={7} profile={wiring} panelTypes={[longi]} reading={reading({ PVPower: 1404, PVVoltage: 118.2 })} today={TODAY} />,
    );

    const tile = screen.getByRole('region', { name: 'PV array' });
    expect(tile).toHaveTextContent('6 × Longi 450W (3S2P)');
    expect(tile).toHaveTextContent('52%');
    expect(tile).toHaveTextContent('1.4 kW of 2.7 kW');
    expect(tile).toHaveTextContent('PV voltage 118.2 V · Vmp 124.5 V');
    expect(await screen.findByText("Today's peak 78% (2.1 kW)")).toBeInTheDocument();
    expect(server.sent[0].params).toMatchObject({ from: dayRange(TODAY).from, fields: 'PVPower' });
  });

  it('shows dashes for values the reading lacks', () => {
    restore = history([]).restore;

    render(<PvArrayTile profileId={7} profile={wiring} panelTypes={[longi]} reading={null} today={TODAY} />);

    const tile = screen.getByRole('region', { name: 'PV array' });
    expect(tile).toHaveTextContent('--%');
    expect(tile).toHaveTextContent('PV voltage -- · Vmp 124.5 V');
  });

  it('points to the setup when no array is configured', () => {
    restore = history([]).restore;

    render(
      <PvArrayTile profileId={7} profile={{ pvPanelTypeId: null, pvPanelsInSeries: null, pvStrings: null }} panelTypes={[longi]} reading={null} today={TODAY} />,
    );

    expect(screen.getByRole('link', { name: 'Set up your solar array' })).toHaveAttribute('href', '/dashboard/7/solar');
  });
});
