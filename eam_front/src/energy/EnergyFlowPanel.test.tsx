import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EnergyFlowPanel from './EnergyFlowPanel';
import type { LatestReading } from '../inverter/types';

const NOW = Date.parse('2026-10-05T12:00:00Z');

const reading = (ageMs: number): LatestReading => ({
  id: 1,
  timestamp: new Date(NOW - ageMs).toISOString(),
  payload: {
    PVPower: 0,
    MainsVoltage: 231.4,
    AverageMainsPower: 0,
    BatterySoc: 88,
    BatteryVoltage: 26.5,
    BatteryCurrentSigned: -11.7,
    OutputActivePower: 278,
  },
});

describe('EnergyFlowPanel', () => {
  it('draws a fresh reading live', () => {
    render(<EnergyFlowPanel reading={reading(3_000)} pollMs={5_000} now={() => NOW} />);

    expect(screen.getByTestId('flow-line-battery')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('flow-value-load')).toHaveTextContent('278W');
    expect(screen.queryByTestId('flow-freshness')).toBeNull();
  });

  it('goes stale after three poll intervals without a new reading', () => {
    render(<EnergyFlowPanel reading={reading(16_000)} pollMs={5_000} now={() => NOW} />);

    expect(screen.getByTestId('flow-line-battery')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('flow-freshness')).toHaveTextContent('Last updated 16s ago');
  });

  it('shows "--" everywhere and offline without a reading', () => {
    render(<EnergyFlowPanel reading={null} pollMs={5_000} now={() => NOW} />);

    expect(screen.getByTestId('flow-value-battery')).toHaveTextContent('--');
    expect(screen.getByTestId('flow-freshness')).toHaveTextContent('Offline');
  });

  it("shows PV utilization when the array's rating is known", () => {
    const sunny = { ...reading(3_000), payload: { ...reading(3_000).payload, PVPower: 1404 } };
    render(<EnergyFlowPanel reading={sunny} pollMs={5_000} pvRatedW={2700} now={() => NOW} />);

    expect(screen.getByTestId('flow-value-pv')).toHaveTextContent('1.4kW · 52%');
  });
});
