import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BmsSettingsPanel from './BmsSettingsPanel';
import type { BmsSettingsReport } from './types';

const report: BmsSettingsReport = {
  protocol: 'JK02_32S',
  decoderVersion: 'jk-ble/2',
  receivedAt: '2026-11-06T17:08:30.000Z',
  settings: {
    cellOvervoltageProtectionV: 3.6,
    cellOvervoltageRecoveryV: 3.448,
    cellChargeV: 3.45,
    cellFloatV: 3.35,
    balanceStartV: 3.4,
    balanceTriggerDeltaV: 0.01,
    balancerEnabled: true,
    maxChargeCurrentA: 48,
    chargeOvercurrentDelayS: 3,
    chargeUndertemperatureC: 2,
    mosfetOvertemperatureC: 80,
    cellCount: 8,
    nominalCapacityAh: 102,
    dischargeEnabled: false,
    someFutureSetting: 7,
  },
};

const row = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

describe('BmsSettingsPanel', () => {
  it('lists the settings by group, with units, and says they are read-only', () => {
    render(<BmsSettingsPanel report={report} />);

    expect(screen.getByRole('heading', { name: 'BMS settings' })).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cell voltages' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Temperatures' })).toBeInTheDocument();

    expect(within(row('Cell overvoltage protection')).getByText('3.600 V')).toBeInTheDocument();
    expect(within(row('Charge voltage (per cell)')).getByText('3.450 V')).toBeInTheDocument();
    expect(within(row('Max charge current')).getByText('48 A')).toBeInTheDocument();
    expect(within(row('Charge overcurrent delay')).getByText('3 s')).toBeInTheDocument();
    expect(within(row('Charge undertemperature protection')).getByText('2.0 °C')).toBeInTheDocument();
    expect(within(row('Cell count')).getByText('8')).toBeInTheDocument();
    expect(within(row('Nominal capacity')).getByText('102 Ah')).toBeInTheDocument();
    expect(within(row('Balancer')).getByText('On')).toBeInTheDocument();
    expect(within(row('Discharge')).getByText('Off')).toBeInTheDocument();
  });

  it('shows settings it has no label for under their own name', () => {
    render(<BmsSettingsPanel report={report} />);
    expect(within(row('someFutureSetting')).getByText('7')).toBeInTheDocument();
  });

  it('leaves out settings the BMS did not send', () => {
    render(<BmsSettingsPanel report={report} />);
    expect(screen.queryByText('Smart sleep voltage')).not.toBeInTheDocument();
  });

  it('says so when the BMS has not sent its settings yet', () => {
    render(<BmsSettingsPanel report={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('The BMS sends its settings when the reader connects');
  });
});
