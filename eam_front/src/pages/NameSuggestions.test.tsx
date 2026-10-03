import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatGap } from './formatGap';
import NameSuggestions from './NameSuggestions';

const base = { address: 745, raw: 3900, at: 0, gapMs: 252_000 };

describe('formatGap', () => {
  it('says how far the reference reading is from the value, and on which side', () => {
    expect(formatGap(252_000)).toBe('cloud reading 4m12s after this value');
    expect(formatGap(-60_000)).toBe('cloud reading 1m0s before this value');
    expect(formatGap(5_000)).toBe('cloud reading 5s after this value');
    expect(formatGap(2 * 3_600_000 + 60_000)).toBe('cloud reading 2h1m after this value');
  });
});

describe('NameSuggestions', () => {
  it('lists matching reference fields with their scale and how strong the evidence is', () => {
    render(
      <NameSuggestions
        suggestion={{
          ...base,
          matches: [
            { field: 'inverter', value: 3900, scale: 1, exact: true, digits: 2, stable: true },
            { field: 'batteryVoltageV', value: 27.4, scale: 0.01, exact: false, digits: 3, stable: false },
          ],
        }}
      />,
    );
    expect(screen.getByText('inverter = 3900')).toBeInTheDocument();
    expect(screen.getByText('batteryVoltageV ≈ 27.4 (×0.01) · changes fast')).toBeInTheDocument();
    expect(screen.getByText('cloud reading 4m12s after this value')).toBeInTheDocument();
  });

  it('shows only the three strongest matches and how many more there are', () => {
    const matches = ['a', 'b', 'c', 'd', 'e'].map((field) => ({ field, value: 1, scale: 1, exact: true, digits: 1, stable: true }));
    render(<NameSuggestions suggestion={{ ...base, matches }} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('collapses a zero into a count', () => {
    render(<NameSuggestions suggestion={{ ...base, raw: 0, matches: [], zeroMatches: 8 }} />);
    expect(screen.getByText('0 matches 8 reference fields')).toBeInTheDocument();
  });

  it('says when nothing matches', () => {
    render(<NameSuggestions suggestion={{ ...base, matches: [] }} />);
    expect(screen.getByText('no matching reference field')).toBeInTheDocument();
  });
});
