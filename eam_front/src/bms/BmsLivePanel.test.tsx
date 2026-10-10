import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BmsLivePanel from './BmsLivePanel';
import type { BmsLatest, BmsReading } from './types';

const reading: BmsReading = {
  timestamp: '2026-10-06T12:00:00.000Z',
  source: 'mac-ble',
  protocol: 'JK02_32S',
  decoderVersion: 'jk-ble/1',
  packVoltageV: 26.524,
  currentA: -11.71,
  powerW: -310.6,
  stateOfChargePct: 88,
  remainingCapacityAh: 88.1,
  nominalCapacityAh: 100,
  cycleCount: 12,
  cellVoltagesV: [3.316, 3.315, 3.309, 3.318, 3.317, 3.316, 3.314, 3.319],
  cellMinV: 3.309,
  cellMaxV: 3.319,
  cellAverageV: 3.3155,
  cellDeltaV: 0.01,
  cellMinIndex: 3,
  cellMaxIndex: 8,
  temperaturesC: [
    { name: 'T1', celsius: 21.4 },
    { name: 'T2', celsius: 21.9 },
    { name: 'MOS', celsius: 24.1 },
  ],
  temperatureSensorMask: 7,
  balancing: true,
  balanceCurrentA: 0.04,
  chargeMosfetOn: true,
  dischargeMosfetOn: false,
  alarmMask: 0,
  alarms: [],
};

const live: BmsLatest = { reading, ageSeconds: 3, status: 'live' };

describe('BmsLivePanel', () => {
  it('shows state of charge, pack voltage, current and power', () => {
    render(<BmsLivePanel latest={live} />);

    expect(screen.getByTestId('bms-soc')).toHaveTextContent('88%');
    expect(screen.getByText('Discharging')).toBeInTheDocument();
    expect(screen.getByText('Empty in 7 h 31 m at the current rate')).toBeInTheDocument();
    expect(screen.getByTestId('bms-voltage')).toHaveTextContent('26.52 V');
    expect(screen.getByTestId('bms-current')).toHaveTextContent('-11.71 A');
    expect(screen.getByTestId('bms-current')).toHaveTextContent('out of the pack');
    expect(screen.getByTestId('bms-power')).toHaveTextContent('311 W');
    expect(screen.getByTestId('bms-power')).toHaveTextContent('discharging');
    expect(screen.getByTestId('bms-remaining')).toHaveTextContent('88.1 Ah');
    expect(screen.getByTestId('bms-remaining')).toHaveTextContent('of 100 Ah');
    expect(screen.getByTestId('bms-cycles')).toHaveTextContent('12');
  });

  it('lists every cell, marking the lowest and highest, with the spread', () => {
    render(<BmsLivePanel latest={live} />);

    const cells = within(screen.getByRole('list', { name: 'Cell voltages' })).getAllByRole('listitem');
    expect(cells).toHaveLength(8);
    expect(cells[0]).toHaveAccessibleName('Cell 1: 3.316 V');
    expect(cells[0]).toHaveTextContent('3.316');
    expect(cells[2]).toHaveAttribute('data-extreme', 'min');
    expect(cells[7]).toHaveAttribute('data-extreme', 'max');
    expect(cells[0]).not.toHaveAttribute('data-extreme');
    expect(screen.getByText('Spread 10 mV')).toBeInTheDocument();
  });

  it('shows temperatures, balancing, MOSFETs and alarms', () => {
    render(<BmsLivePanel latest={{ ...live, reading: { ...reading, alarms: ['Cell undervoltage'] } }} />);

    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.getByText('21.4 °C')).toBeInTheDocument();
    expect(screen.getByText('MOS')).toBeInTheDocument();
    expect(screen.getByTestId('bms-balancing')).toHaveTextContent('Balancing (0.04 A)');
    expect(screen.getByTestId('bms-charge-mosfet')).toHaveTextContent('On');
    expect(screen.getByTestId('bms-discharge-mosfet')).toHaveTextContent('Off');
    expect(screen.getByRole('list', { name: 'Alarms' })).toHaveTextContent('Cell undervoltage');
  });

  it('says when there are no alarms and the balancer is idle', () => {
    render(<BmsLivePanel latest={{ ...live, reading: { ...reading, balancing: false } }} />);

    expect(screen.getByText('No alarms')).toBeInTheDocument();
    expect(screen.getByTestId('bms-balancing')).toHaveTextContent('Idle');
  });

  it('never presents a stale reading as current', () => {
    render(<BmsLivePanel latest={{ ...live, ageSeconds: 150, status: 'stale' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Last reading 2m ago, not current');
    expect(screen.getByTestId('bms-panel')).toHaveAttribute('data-stale', 'true');
  });

  it('shows "--" for values the BMS does not provide', () => {
    render(<BmsLivePanel latest={{ ...live, reading: { ...reading, currentA: null, powerW: null, stateOfChargePct: null } }} />);

    expect(screen.getByTestId('bms-soc')).toHaveTextContent('--');
    expect(screen.getByTestId('bms-current')).toHaveTextContent('--');
    expect(screen.getByTestId('bms-power')).toHaveTextContent('--');
  });

  it('says the BMS has not reported yet', () => {
    render(<BmsLivePanel latest={null} />);

    expect(screen.getByRole('status')).toHaveTextContent('No reading from the BMS yet');
  });
});
