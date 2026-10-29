/**
 * Settings rules for the EASUN ISOLAR SMG-II, from its manual's LCD setting
 * programs and specification (docs/smg-ii-manual-settings.json), in
 * devices/smg-ii/settings-rules.json.
 */
import file from '../devices/smg-ii/settings-rules.json';
import { parseSettingsRulesFile } from '../devices/device-files.ts';
import { SMG_II_REGISTERS } from '../registers/smg-ii.registers.ts';
import type { Bounds, SettingsConstraints } from './settings-rules.ts';

/** What the rules need to know about the installation. */
export interface InstallationProfile {
  batteryNominalVoltage: number;
  batteryType: string;
}

const RULES = parseSettingsRulesFile(
  file,
  SMG_II_REGISTERS,
  'devices/smg-ii/settings-rules.json',
);

export function settingsConstraints(
  profile: InstallationProfile,
): SettingsConstraints {
  const voltage = profile.batteryNominalVoltage;
  const voltageRanges = RULES.voltageRanges[voltage];

  const defaults: Record<string, number> = {};
  for (const definition of SMG_II_REGISTERS) {
    if (definition.group !== 'settings') continue;
    const value =
      definition.defaultByBatteryVoltage?.[voltage] ?? definition.default;
    if (value !== undefined) defaults[definition.name] = value;
  }

  const bounds: Record<string, Bounds> = { ...RULES.currentRanges };
  for (const [name, range] of Object.entries(voltageRanges ?? {})) {
    bounds[name] = { ...range, context: `for a ${voltage} V battery` };
  }

  return {
    batteryVoltage: voltageRanges ? voltage : null,
    bounds,
    defaults,
    rules: [
      ...RULES.rules,
      ...RULES.inactiveRules,
      ...(profile.batteryType === 'LIFEPO4' ? RULES.lithiumRules : []),
    ],
  };
}
