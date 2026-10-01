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
}
