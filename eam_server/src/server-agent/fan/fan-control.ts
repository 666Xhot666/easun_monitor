/** The owner's fan settings, as the server keeps them. */
export interface FanSettings {
  /** FIRMWARE: the machine decides. AUTO: the rules. MANUAL: a fixed speed. */
  mode: 'FIRMWARE' | 'AUTO' | 'MANUAL';
  /** AUTO: never slower than this (0-100 %). */
  minPercent: number;
  /** MANUAL: the speed (0-100 %). */
  manualPercent: number;
  /** AUTO: above `aboveC` °C, at least `percent` %. */
  rules: Array<{ aboveC: number; percent: number }>;
}

/** What to do with the fan: hand it to the firmware, or set a speed. */
export type FanTarget =
  | { mode: 'firmware' }
  /** `rule`: the threshold of the AUTO rule in force, if any. */
  | { mode: 'manual'; percent: number; rule: number | null };

/** A rule is left only this far below its threshold, so the fan does not flap. */
export const HYSTERESIS_C = 3;

/**
 * The fan speed for `temperature` (the hottest sensor; null when none could
 * be read, which means full speed), given what it was set to last time.
 */
export function fanTarget(
  settings: FanSettings,
  temperature: number | null,
  previous: FanTarget | null,
): FanTarget {
  if (settings.mode === 'FIRMWARE') return { mode: 'firmware' };
  if (settings.mode === 'MANUAL') {
    return { mode: 'manual', percent: settings.manualPercent, rule: null };
  }
  if (temperature === null) return { mode: 'manual', percent: 100, rule: null };

  const rules = [...settings.rules].sort((a, b) => a.aboveC - b.aboveC);
  const at = (rule: (typeof rules)[number] | undefined): FanTarget => ({
    mode: 'manual',
    percent: Math.max(settings.minPercent, rule?.percent ?? 0),
    rule: rule?.aboveC ?? null,
  });
  const target = at(rules.findLast((r) => temperature > r.aboveC));

  // Keep a higher rule until the temperature is well below it.
  const held =
    previous?.mode === 'manual' && previous.rule !== null
      ? rules.find((r) => r.aboveC === previous.rule)
      : undefined;
  if (
    held &&
    target.mode === 'manual' &&
    (target.rule ?? -Infinity) < held.aboveC &&
    temperature > held.aboveC - HYSTERESIS_C
  ) {
    return at(held);
  }
  return target;
}

/**
 * The PWM value (0-255) for `percent`; for a fan with a few fixed speeds
 * (`steps`, off included), the nearest of them.
 */
export function toPwm(percent: number, steps: number | null): number {
  const level = levelOf(percent, steps);
  if (level === null) return Math.round((percent * 255) / 100);
  return Math.round((level * 255) / (steps! - 1));
}

/** Which of `steps` speeds (0 = off) `percent` gives; null for a fan without fixed speeds. */
export function levelOf(percent: number, steps: number | null): number | null {
  if (!steps || steps < 2) return null;
  return Math.round((percent / 100) * (steps - 1));
}
