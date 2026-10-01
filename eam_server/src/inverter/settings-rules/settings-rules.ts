/**
 * Settings rules: what a settings change must respect beyond a single
 * register's own range, as plain data. The server resolves them for a
 * profile (its battery voltage and type), enforces them on every write
 * and serves them to the settings page, which runs the same checks while
 * the user edits.
 *
 * No imports and only type-erasable TypeScript, like the Register map.
 */

/** Real-unit bounds for one setting. */
export interface Bounds {
  min?: number;
  max?: number;
  /** Why these bounds apply, appended to the message ("for a 24 V battery"). */
  context?: string;
}

/** The rules for one profile, as served by GET .../settings/constraints. */
export interface SettingsConstraints {
  /** Nominal battery voltage the ranges were resolved for; null if the
   * manual covers no ranges for it. */
  batteryVoltage: number | null;
  /** Setting name -> allowed range, tighter than the register's own. */
  bounds: Record<string, Bounds>;
  /** Setting name -> factory default for this installation. */
  defaults: Record<string, number>;
  rules: SettingsRule[];
}

/**
 * `left op (right + offset)` must hold. Errors block the write; warnings
 * need the user's acknowledgement. `id` names the manual rule (R-*).
 */
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

export type SettingsRule = CompareRule;

/** Per setting: what blocks the change, what needs acknowledging, and
 * why a setting currently has no effect. */
export interface SettingsCheck {
  errors: Record<string, string[]>;
  warnings: Record<string, string[]>;
  inactive: Record<string, string>;
}

/**
 * Checks `changes` against the rules, given the inverter's `current`
 * values. Only rules involving a changed setting can fail, so a value
 * already on the inverter never blocks an unrelated change.
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
