import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FanController } from './fan-controller';
import { FanDevice } from './fan-device';
import type { FanSettings } from './fan-control';

function host(): { root: string; fan: string } {
  const root = mkdtempSync(join(tmpdir(), 'host-'));
  const other = join(root, 'sys/class/hwmon/hwmon5');
  const fan = join(root, 'sys/class/hwmon/hwmon6');
  mkdirSync(other, { recursive: true });
  mkdirSync(fan, { recursive: true });
  writeFileSync(join(other, 'name'), 'coretemp\n');
  writeFileSync(join(fan, 'name'), 'fanchip\n');
  writeFileSync(join(fan, 'pwm1'), '0\n');
  writeFileSync(join(fan, 'pwm1_enable'), '');
  return { root, fan };
}
const read = (dir: string, file: string) =>
  readFileSync(join(dir, file), 'utf8').trim();

describe('FanDevice', () => {
  it('finds the fan by its hwmon name, sets a speed and hands it back to the firmware', () => {
    const { root, fan } = host();
    expect(FanDevice.find(root, 'missing')).toBeNull();
    const device = FanDevice.find(root, 'fanchip')!;

    device.setPwm(128);
    expect(read(fan, 'pwm1_enable')).toBe('1');
    expect(read(fan, 'pwm1')).toBe('128');

    device.release();
    expect(read(fan, 'pwm1_enable')).toBe('2');
  });
});

describe('FanController', () => {
  const settings = (over: Partial<FanSettings> = {}): FanSettings => ({
    mode: 'AUTO',
    minPercent: 0,
    manualPercent: 100,
    rules: [{ aboveC: 80, percent: 100 }],
    ...over,
  });

  it('applies the settings each cycle and says what it did', () => {
    const { root, fan } = host();
    const control = new FanController(FanDevice.find(root, 'fanchip'), 3);

    expect(control.apply(settings(), 85)).toEqual({
      mode: 'manual',
      percent: 100,
      pwm: 255,
      steps: 3,
      error: null,
    });
    expect(read(fan, 'pwm1')).toBe('255');

    expect(
      control.apply(settings({ mode: 'MANUAL', manualPercent: 30 }), 85),
    ).toMatchObject({
      percent: 30,
      pwm: 128,
    });

    expect(control.apply(settings({ mode: 'FIRMWARE' }), 85)).toEqual({
      mode: 'firmware',
      percent: null,
      pwm: null,
      steps: 3,
      error: null,
    });
    expect(read(fan, 'pwm1_enable')).toBe('2');
  });

  it('leaves the fan alone without settings, and reports a fan it cannot write', () => {
    const { root, fan } = host();
    const control = new FanController(FanDevice.find(root, 'fanchip'), 3);
    expect(control.apply(null, 85)).toMatchObject({ mode: 'firmware' });
    expect(read(fan, 'pwm1_enable')).toBe('');

    const broken = new FanController(
      {
        setPwm: () => {
          throw new Error("EACCES: permission denied, open 'pwm1_enable'");
        },
        release: () => {},
      },
      3,
    );
    expect(broken.apply(settings(), 85)).toMatchObject({
      mode: 'firmware',
      error: "EACCES: permission denied, open 'pwm1_enable'",
    });
  });

  it('has nothing to say without a fan device', () => {
    expect(new FanController(null, null).apply(settings(), 85)).toBeNull();
  });
});
