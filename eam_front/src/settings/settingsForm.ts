import i18n from '../i18n';
import { decimalsFor } from '../inverter/format';
import type { RegisterDefinition } from '@eam/shared/inverter';

/** Form state: register name -> the text in its input (enum: option index). */
export type FormValues = Record<string, string>;

export interface SettingsSection {
  /** Stable: for anchors and filters. */
  key: string;
  /** In the current language. */
  title: string;
  registers: RegisterDefinition[];
}

/**
 * Sections as in the manual's setting programs, each listing its settings in
 * program order (number in comments). Writable settings not listed here go
 * to "Other"; read-only settings go last. Settings that can cut power or harm
 * the battery (`risk`) sit with their related settings; the page confirms
 * each change to them.
 */

const SECTIONS: { key: string; names: string[] }[] = [
  {
    key: 'output',
    names: [
      'OutputMode',
      'OutputPriority', // 01
      'InputVoltageRange', // 03
      'OutputVoltageSet', // 08
      'OutputFrequencySet', // 09
      'BatteryChargingPriority', // 16
    ],
  },
  {
    key: 'battery',
    names: [
      'MaxChargingCurrent', // 02
      'MaxMainsChargingCurrent', // 11
      'BatteryLowVoltageProtectionMains', // 12
      'BatteryDischargeRecoveryMains', // 13
      'MaxChargingVoltage', // 26
      'FloatingChargingVoltage', // 27
      'BatteryOvervoltageProtection',
      'BatteryLowVoltageProtectionOffGrid', // 29
      'TimeFromCVToFloating',
      'LowDcProtectionSocGrid',
      'SocRecoveryMains',
      'OffGridSocProtection',
    ],
  },
  {
    key: 'equalization',
    names: [
      'BatteryEqModeEnabled', // 33
      'EqChargingVoltage', // 34
      'BatteryEqualizationTime', // 35
      'EqualizationTimeoutExit', // 36
      'TwoEqChargingIntervals', // 37
    ],
  },
  {
    key: 'protection',
    names: [
      'OverloadAutoRestart', // 06
      'OverTempAutoRestart', // 07
      'OverloadTransferToBypass', // 23
    ],
  },
  {
    key: 'display',
    names: [
      'BuzzerMode', // 18
      'BeepsWhilePrimarySourceInterrupted',
      'LcdAutoReturn', // 19
      'LcdBacklight', // 20
    ],
  },
  {
    key: 'power',
    names: [
      'EnergySavingMode',
      'AutoACOutput',
      'TurnOnMode',
      'RemoteSwitch',
      'OutputControl',
    ],
  },
];

const settingsOf = (definitions: RegisterDefinition[]) =>
  definitions.filter((d) => d.group === 'settings').sort((a, b) => a.address - b.address);

export function groupIntoSections(definitions: RegisterDefinition[]): SettingsSection[] {
  const settings = settingsOf(definitions);
  const writable = settings.filter((d) => d.writable);
  const title = (key: string) => i18n.t(`sections.${key}`);
  const sections = SECTIONS.map(({ key, names }) => ({
    key,
    title: title(key),
    registers: names.flatMap((name) => writable.filter((d) => d.name === name)),
  }));
  const placed = new Set(sections.flatMap((s) => s.registers));
  const other = writable.filter((d) => !placed.has(d));
  if (other.length) sections.push({ key: 'other', title: title('other'), registers: other });
  sections.push({ key: 'device', title: title('device'), registers: settings.filter((d) => !d.writable && d.verified !== false) });
  sections.push({ key: 'unverified', title: title('unverified'), registers: settings.filter((d) => d.verified === false) });
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
      errors[definition.name] = i18n.t('validation.enterNumber');
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
      : i18n.t('validation.pickOption');
  }
  if (
    (definition.min !== undefined && value < definition.min) ||
    (definition.max !== undefined && value > definition.max)
  ) {
    return i18n.t('validation.between', { min: definition.min ?? '-∞', max: definition.max ?? '∞', unit });
  }
  const scale = definition.scale ?? 1;
  if (Math.abs(Math.round(value / scale) * scale - value) > scale / 1000) {
    return i18n.t('validation.steps', { step: scale, unit });
  }
  return null;
}
