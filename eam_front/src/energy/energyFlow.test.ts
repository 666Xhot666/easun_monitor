import { describe, expect, it } from 'vitest';
import { formatPower } from './energyFlow';

describe('formatPower', () => {
  it('shows whole watts below 1 kW', () => {
    expect(formatPower(0)).toBe('0W');
    expect(formatPower(278)).toBe('278W');
    expect(formatPower(999.6)).toBe('1000W');
  });

  it('shows kW with one decimal above 1000 W', () => {
    expect(formatPower(1200)).toBe('1.2kW');
    expect(formatPower(3456)).toBe('3.5kW');
  });

  it('shows the magnitude: direction is drawn, not written', () => {
    expect(formatPower(-310)).toBe('310W');
  });

  it('shows "--" when there is no value', () => {
    expect(formatPower(undefined)).toBe('--');
    expect(formatPower(Number.NaN)).toBe('--');
  });
});
