/**
 * The server's Settings rules for one profile, as served by
 * GET /api/inverter/:profileId/settings/constraints, and the same check the
 * server runs before writing. Mirrored here so problems show while the user
 * edits; the server remains the authority.
 */

export interface Bounds {
  min?: number;
  max?: number;
  /** Why these bounds apply ("for a 24 V battery"). */
  context?: string;
}

export interface CompareRule {
  id: string;
  kind: 'compare';
  severity: 'error' | 'warning';
  left: string;
  op: '>' | '>=' | '<=';
  right: string;
  offset?: number;
  message: string;
}

export interface InactiveRule {
  id: string;
  kind: 'inactive';
  settings: string[];
  when: string;
  in: number[];
  reason: string;
}

export interface AvoidRule {
  id: string;
  kind: 'avoid';
  setting: string;
  value: number;
  message: string;
}

export type SettingsRule = CompareRule | InactiveRule | AvoidRule;

export interface SettingsConstraints {
  batteryVoltage: number | null;
  bounds: Record<string, Bounds>;
  defaults: Record<string, number>;
  rules: SettingsRule[];
}

export const NO_CONSTRAINTS: SettingsConstraints = { batteryVoltage: null, bounds: {}, defaults: {}, rules: [] };

export interface SettingsCheck {
  errors: Record<string, string[]>;
  warnings: Record<string, string[]>;
  inactive: Record<string, string>;
}

/**
 * Checks `changes` given the inverter's `current` values. Only rules
 * involving a changed setting can fail, so a value already on the
 * inverter never blocks an unrelated change.
 */
export function checkSettings(
  constraints: SettingsConstraints,
  current: Record<string, number>,
  changes: Record<string, number>,
): SettingsCheck {
  const result: SettingsCheck = { errors: {}, warnings: {}, inactive: {} };
  const add = (into: Record<string, string[]>, name: string, message: string) => {
    (into[name] ??= []).push(message);
  };

  for (const [name, value] of Object.entries(changes)) {
    const bounds = constraints.bounds[name];
    if (!bounds) continue;
    if ((bounds.min !== undefined && value < bounds.min) || (bounds.max !== undefined && value > bounds.max)) {
      const context = bounds.context ? ` ${bounds.context}` : '';
      add(result.errors, name, `Must be between ${bounds.min ?? '-∞'} and ${bounds.max ?? '∞'}${context}`);
    }
  }

  const values = { ...current, ...changes };
  for (const rule of constraints.rules) {
    if (rule.kind === 'inactive') {
      const value = values[rule.when];
      if (value === undefined || rule.in.includes(value)) continue;
      for (const name of rule.settings) result.inactive[name] = rule.reason;
      continue;
    }
    if (rule.kind === 'avoid') {
      if (changes[rule.setting] === rule.value) add(result.warnings, rule.setting, rule.message);
      continue;
    }
    if (!(rule.left in changes) && !(rule.right in changes)) continue;
    const left = values[rule.left];
    const right = values[rule.right];
    if (left === undefined || right === undefined) continue;
    if (!compare(left, rule.op, right + (rule.offset ?? 0))) {
      const into = rule.severity === 'error' ? result.errors : result.warnings;
      add(into, rule.left, rule.message);
      add(into, rule.right, rule.message);
    }
  }
  return result;
}

/** Compares at 0.001 resolution, so 27.0 + 0.4 equals 27.4. */
function compare(left: number, op: CompareRule['op'], right: number): boolean {
  const difference = Math.round((left - right) * 1000);
  return op === '>' ? difference > 0 : op === '>=' ? difference >= 0 : difference <= 0;
}
