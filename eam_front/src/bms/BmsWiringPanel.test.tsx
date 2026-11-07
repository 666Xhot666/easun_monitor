import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BmsWiringPanel from './BmsWiringPanel';
import type { BmsWiring, WiringFit } from './types';

const fit: WiringFit = { resistanceOhm: 0.0125, offsetV: -0.23, samples: 1040, minCurrentA: -78, maxCurrentA: 43 };
const wiring: BmsWiring = {
  overall: fit,
  weeks: [
    { from: '2026-10-24T00:00:00.000Z', fit: { ...fit, resistanceOhm: 0.0131, samples: 300 } },
    { from: '2026-10-31T00:00:00.000Z', fit: { ...fit, resistanceOhm: 0.0124, offsetV: -0.22, samples: 740 } },
  ],
};

const cell = (row: string, column: number) =>
  within(screen.getByRole('row', { name: new RegExp(row) })).getAllByRole('cell')[column];

describe('BmsWiringPanel', () => {
  it('shows the path resistance and the inverter offset', () => {
    render(<BmsWiringPanel wiring={wiring} cutoffV={23.5} />);

    expect(screen.getByRole('heading', { name: 'Battery voltage at the inverter' })).toBeInTheDocument();
    expect(screen.getByTestId('wiring-resistance')).toHaveTextContent('12.5 mΩ');
    expect(screen.getByTestId('wiring-offset')).toHaveTextContent('-0.23 V');
    expect(screen.getByTestId('wiring-samples')).toHaveTextContent('1040');
  });

  it('tells how much lower the inverter reads while discharging, and what its cut-off means at the battery', () => {
    render(<BmsWiringPanel wiring={wiring} cutoffV={23.5} />);

    // 0.23 V offset + 75 A × 12.5 mΩ = 1.17 V; cut-off 23.5 V on the inverter = 24.67 V at the battery.
    expect(cell('Inverter reads lower by', 2)).toHaveTextContent('1.17 V');
    expect(cell('Inverter reads lower by', 0)).toHaveTextContent('0.54 V');
    expect(cell('Cut-off 23.5 V on the inverter', 2)).toHaveTextContent('24.67 V');
    expect(screen.getByRole('columnheader', { name: '75 A' })).toBeInTheDocument();
  });

  it('leaves out the cut-off row while the inverter setting is unknown', () => {
    render(<BmsWiringPanel wiring={wiring} cutoffV={null} />);
    expect(screen.queryByRole('row', { name: /Cut-off/ })).not.toBeInTheDocument();
  });

  it('lists the weekly fits, to show a trend', () => {
    render(<BmsWiringPanel wiring={wiring} cutoffV={23.5} />);
    const weeks = within(screen.getByRole('list', { name: 'By week' })).getAllByRole('listitem');
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toHaveTextContent('13.1 mΩ');
    expect(weeks[1]).toHaveTextContent('12.4 mΩ');
  });

  it('says what is missing when there is no fit yet', () => {
    render(<BmsWiringPanel wiring={{ overall: null, weeks: [] }} cutoffV={23.5} />);
    expect(screen.getByRole('status')).toHaveTextContent('Not enough readings yet');
  });
});
