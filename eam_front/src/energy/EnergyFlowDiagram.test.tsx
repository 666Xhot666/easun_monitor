import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EnergyFlowDiagram from './EnergyFlowDiagram';
import type { EnergyFlow, FlowConnection } from './energyFlow';

const idle = (value: string, overrides: Partial<FlowConnection> = {}): FlowConnection => ({
  value,
  active: false,
  direction: 'toInverter',
  available: true,
  ...overrides,
});

/** The reference screenshot, already computed. */
const NIGHT_ON_BATTERY: EnergyFlow = {
  pv: idle('0W', { available: false, watts: 0 }),
  grid: idle('0W', { watts: 0 }),
  battery: { value: '88%', active: true, direction: 'toInverter', available: true, watts: 310 },
  load: { value: '278W', active: true, direction: 'fromInverter', available: true, watts: 278 },
};

describe('EnergyFlowDiagram', () => {
  it('labels the inverter and the four nodes around it', () => {
    render(<EnergyFlowDiagram flow={NIGHT_ON_BATTERY} />);

    expect(screen.getByRole('img', { name: 'Energy flow' })).toBeInTheDocument();
    for (const label of ['Device', 'PV', 'Grid', 'Battery', 'Load']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows each value on its line, blue only while the line is active', () => {
    render(<EnergyFlowDiagram flow={NIGHT_ON_BATTERY} />);

    expect(screen.getByTestId('flow-value-pv')).toHaveTextContent('0W');
    expect(screen.getByTestId('flow-value-pv')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('flow-value-grid')).toHaveTextContent('0W');
    expect(screen.getByTestId('flow-value-battery')).toHaveTextContent('88%');
    expect(screen.getByTestId('flow-value-battery')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('flow-value-load')).toHaveTextContent('278W');
  });

  it('animates dots only on active lines, in the direction of flow', () => {
    render(<EnergyFlowDiagram flow={NIGHT_ON_BATTERY} />);

    expect(screen.getByTestId('flow-line-pv')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('flow-line-grid')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('flow-line-battery')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('flow-line-battery')).toHaveAttribute('data-direction', 'toInverter');
    expect(screen.getByTestId('flow-line-load')).toHaveAttribute('data-direction', 'fromInverter');
    expect(screen.getByTestId('flow-line-pv').querySelector('.flow-dots')).toBeNull();
    expect(screen.getByTestId('flow-line-battery').querySelector('.flow-dots')).not.toBeNull();
  });

  it('dims the icon of an unavailable source, independent of its line', () => {
    render(<EnergyFlowDiagram flow={NIGHT_ON_BATTERY} />);

    expect(screen.getByTestId('flow-node-pv')).toHaveAttribute('data-available', 'false');
    expect(screen.getByTestId('flow-node-grid')).toHaveAttribute('data-available', 'true');
  });
});
