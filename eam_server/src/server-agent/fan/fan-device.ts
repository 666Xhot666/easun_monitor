import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the fan controller needs of a fan. */
export interface Fan {
  /** Takes the fan from the firmware and sets its PWM (0-255). */
  setPwm(pwm: number): void;
  /** Hands the fan back to the firmware. */
  release(): void;
}

/**
 * A fan the kernel exposes as hwmon pwm1: pwm1_enable 1 is manual control,
 * 2 the firmware's. Writing needs permission on both files (see the
 * installer).
 */
export class FanDevice implements Fan {
  private constructor(private readonly dir: string) {}

  /** The hwmon device called `name` that has a pwm1, or null. */
  static find(root: string, name: string): FanDevice | null {
    const base = join(root, 'sys/class/hwmon');
    let entries: string[];
    try {
      entries = readdirSync(base);
    } catch {
      return null;
    }
    for (const entry of entries) {
      const dir = join(base, entry);
      try {
        if (readFileSync(join(dir, 'name'), 'utf8').trim() !== name) continue;
        readFileSync(join(dir, 'pwm1'));
        return new FanDevice(dir);
      } catch {
        continue;
      }
    }
    return null;
  }

  setPwm(pwm: number): void {
    writeFileSync(join(this.dir, 'pwm1_enable'), '1');
    writeFileSync(join(this.dir, 'pwm1'), String(pwm));
  }

  release(): void {
    writeFileSync(join(this.dir, 'pwm1_enable'), '2');
  }
}
