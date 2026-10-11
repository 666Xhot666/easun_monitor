import {
  fanTarget,
  toPwm,
  type FanSettings,
  type FanTarget,
} from './fan-control';
import type { Fan } from './fan-device';

/** What the agent did with the fan, reported with each sample. */
export interface FanControlState {
  mode: 'firmware' | 'manual';
  percent: number | null;
  pwm: number | null;
  /** The fan's fixed speeds (off included), when it has them. */
  steps: number | null;
  /** Why the fan could not be set; it is left to the firmware then. */
  error: string | null;
}

/** Sets the fan from the owner's settings and the hottest temperature, every cycle. */
export class FanController {
  private last: FanTarget | null = null;
  private manual = false;

  constructor(
    private readonly fan: Fan | null,
    private readonly steps: number | null,
  ) {}

  /** null without a fan to control. `settings` null: none from the server yet. */
  apply(
    settings: FanSettings | null,
    temperature: number | null,
  ): FanControlState | null {
    if (!this.fan) return null;
    const firmware = (error: string | null): FanControlState => ({
      mode: 'firmware',
      percent: null,
      pwm: null,
      steps: this.steps,
      error,
    });
    if (!settings) return firmware(null);

    const target = fanTarget(settings, temperature, this.last);
    this.last = target;
    try {
      if (target.mode === 'firmware') {
        // Only on the change, so a firmware-run fan is not written to each cycle.
        if (this.manual) this.fan.release();
        this.manual = false;
        return firmware(null);
      }
      // Set again each cycle, in case the firmware took the fan back.
      const pwm = toPwm(target.percent, this.steps);
      this.fan.setPwm(pwm);
      this.manual = true;
      return {
        mode: 'manual',
        percent: target.percent,
        pwm,
        steps: this.steps,
        error: null,
      };
    } catch (e) {
      this.last = null;
      return firmware(e instanceof Error ? e.message : String(e));
    }
  }

  /** Hands the fan back to the firmware, e.g. when the agent stops. */
  release(): void {
    if (!this.fan || !this.manual) return;
    try {
      this.fan.release();
    } catch {
      // The service's stop step hands it back too.
    }
    this.manual = false;
  }
}
