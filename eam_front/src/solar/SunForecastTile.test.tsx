import { render as renderUi, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServer, type Reply } from '../test/fakeServer';
import SunForecastTile from './SunForecastTile';

const render = (ui: ReactElement) => renderUi(<MemoryRouter>{ui}</MemoryRouter>);

const forecast = (assumedMounting = false) => ({
  days: [
    { date: '2026-10-14', expectedKWh: 5, actualKWh: 4.5, cloudCover: 20 },
    { date: '2026-10-15', expectedKWh: 3, actualKWh: 2.7, cloudCover: 60 },
    { date: '2026-10-16', expectedKWh: 2, actualKWh: null, cloudCover: 80 },
    { date: '2026-10-17', expectedKWh: 4.3, actualKWh: 2.1, cloudCover: 35 },
    { date: '2026-10-18', expectedKWh: 6.24, actualKWh: null, cloudCover: 12 },
  ],
  hours: [],
  assumedMounting,
});

describe('SunForecastTile', () => {
  let restore = () => {};
  afterEach(() => restore());

  const serve = (reply: Reply) =>
    (restore = fakeServer((config) => (config.url === '/api/inverter/7/solar-forecast' ? reply : { status: 404 })).restore);

  it("shows tomorrow's expected PV, today so far, and how the past week did against the weather", async () => {
    serve({ status: 200, data: forecast() });

    render(<SunForecastTile profileId={7} today="2026-10-17" />);

    const tile = await screen.findByRole('region', { name: 'Sun forecast' });
    expect(await screen.findByText('6.2 kWh')).toBeInTheDocument();
    expect(tile).toHaveTextContent('Tomorrow · 12% cloud');
    expect(tile).toHaveTextContent('2.1 of 4.3 kWh expected');
    // 4.5 + 2.7 of 5 + 3; the day without readings is left out.
    expect(tile).toHaveTextContent(/90%\s*of what the weather allowed/);
    expect(tile).not.toHaveTextContent('assumed');
  });

  it('says when the tilt and facing were assumed', async () => {
    serve({ status: 200, data: forecast(true) });

    render(<SunForecastTile profileId={7} today="2026-10-17" />);

    expect(await screen.findByText(/assumed 30° towards the equator/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set the mounting' })).toHaveAttribute('href', '/dashboard/7/settings/solar');
  });

  it("shows the server's reason when there is no forecast, with a way to set it up", async () => {
    serve({ status: 409, data: { statusCode: 409, message: "Set the inverter's location on the solar array page to see the forecast." } });

    render(<SunForecastTile profileId={7} today="2026-10-17" />);

    expect(await screen.findByText("Set the inverter's location on the solar array page to see the forecast.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up' })).toHaveAttribute('href', '/dashboard/7/settings/solar');
  });
});
