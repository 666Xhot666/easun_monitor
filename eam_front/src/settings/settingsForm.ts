import { decimalsFor } from '../inverter/format';
import type { RegisterDefinition } from '../inverter/types';

/** Form state: register name -> the text in its input (enum: option index). */
export type FormValues = Record<string, string>;

export interface SettingsSection {
  title: string;
  registers: RegisterDefinition[];
}

/**
 * Sections by address range: the protocol document lays related settings
 * out in contiguous address blocks. Read-only settings go last.
 */
const SECTIONS: { title: string; ranges: [number, number][] }[] = [
  { title: 'Output', ranges: [[300, 302], [320, 322]] },
  { title: 'Display and behaviour', ranges: [[303, 310]] },
  { title: 'Battery and charging', ranges: [[311, 319], [323, 399]] },
  { title: 'Power control', ranges: [[400, 425]] },
];

const settingsOf = (definitions: RegisterDefinition[]) =>
  definitions.filter((d) => d.group === 'settings').sort((a, b) => a.address - b.address);

export function groupIntoSections(definitions: RegisterDefinition[]): SettingsSection[] {
  const settings = settingsOf(definitions);
  const writable = settings.filter((d) => d.writable);
  const sections = SECTIONS.map(({ title, ranges }) => ({
    title,
    registers: writable.filter((d) => ranges.some(([lo, hi]) => d.address >= lo && d.address <= hi)),
  }));
  const placed = new Set(sections.flatMap((s) => s.registers));
  const other = writable.filter((d) => !placed.has(d));
  if (other.length) sections.push({ title: 'Other', registers: other });
  sections.push({ title: 'Device information', registers: settings.filter((d) => !d.writable) });
  return sections.filter((s) => s.registers.length > 0);
}

/** Settings values from the inverter -> input text at register resolution. */
export function toFormValues(definitions: RegisterDefinition[], values: Record<string, number>): FormValues {
  const form: FormValues = {};
  for (const definition of settingsOf(definitions)) {
    const value = values[definition.name];
    if (typeof value !== 'number') {
      form[definition.name] = '';
    } else if (definition.options) {
      form[definition.name] = String(value);
    } else {
      form[definition.name] = value.toFixed(decimalsFor(definition));
    }
  }
  return form;
}

/**
 * The edited, writable settings as numbers, plus a message for every field
 * the inverter would refuse. Mirrors the server's validation so mistakes
 * show up before saving; the server remains the authority.
 */
export function collectChanges(
  definitions: RegisterDefinition[],
  original: FormValues,
  form: FormValues,
): { changes: Record<string, number>; errors: Record<string, string> } {
  const changes: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const definition of settingsOf(definitions)) {
    if (!definition.writable) continue;
    const text = (form[definition.name] ?? '').trim();
    if (text === (original[definition.name] ?? '').trim()) continue;

    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) {
      errors[definition.name] = 'Enter a number';
      continue;
    }
    if (original[definition.name] !== '' && value === Number(original[definition.name])) continue;

    const error = validate(definition, value);
    if (error) errors[definition.name] = error;
    else changes[definition.name] = value;
  }
  return { changes, errors };
}

function validate(definition: RegisterDefinition, value: number): string | null {
  const unit = definition.unit ? ` ${definition.unit}` : '';
  if (definition.options) {
    return Number.isInteger(value) && value >= 0 && value < definition.options.length
      ? null
      : 'Pick one of the options';
  }
  if (
    (definition.min !== undefined && value < definition.min) ||
    (definition.max !== undefined && value > definition.max)
  ) {
    return `Must be between ${definition.min ?? '-∞'} and ${definition.max ?? '∞'}${unit}`;
  }
  const scale = definition.scale ?? 1;
  if (Math.abs(Math.round(value / scale) * scale - value) > scale / 1000) {
    return `Use steps of ${scale}${unit}`;
  }
  return null;
}
