import { describe, expect, it } from 'vitest';
import { formatRegisterValue } from './format';
import type { RegisterDefinition } from './types';

const def = (overrides: Partial<RegisterDefinition>): RegisterDefinition => ({
  name: 'X',
  label: 'X',
  address: 1,
  type: 'uint16',
  group: 'telemetry',
  ...overrides,
});

describe('formatRegisterValue', () => {
  it('shows as many decimals as the register resolution, with its unit', () => {
    expect(formatRegisterValue(def({ scale: 0.1, unit: 'V' }), 230.5)).toBe('230.5 V');
    expect(formatRegisterValue(def({ scale: 0.01, unit: 'Hz' }), 50)).toBe('50.00 Hz');
    expect(formatRegisterValue(def({ unit: 'W' }), 1200)).toBe('1,200 W');
  });

  it('shows the option label for enum registers', () => {
    expect(formatRegisterValue(def({ options: ['Standby', 'Mains'] }), 1)).toBe('Mains');
    expect(formatRegisterValue(def({ options: ['Standby', 'Mains'] }), 7)).toBe('Unknown (7)');
  });

  it('says "no data" instead of inventing a value', () => {
    expect(formatRegisterValue(def({ unit: 'V' }), undefined)).toBe('no data');
  });
});
