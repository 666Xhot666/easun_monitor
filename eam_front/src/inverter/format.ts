import type { RegisterDefinition } from './types';

/** Decimals that match a register's resolution: 0.1 -> 1, 0.01 -> 2. */
export function decimalsFor(definition: RegisterDefinition): number {
  const scale = definition.scale ?? 1;
  return scale >= 1 ? 0 : Math.ceil(-Math.log10(scale));
}

/** Human-readable value with unit; "no data" when the reading lacks it. */
export function formatRegisterValue(
  definition: RegisterDefinition,
  value: number | undefined,
): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'no data';
  if (definition.options) {
    return definition.options[value] ?? `Unknown (${value})`;
  }
  const decimals = decimalsFor(definition);
  const number = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return definition.unit ? `${number} ${definition.unit}` : number;
}
