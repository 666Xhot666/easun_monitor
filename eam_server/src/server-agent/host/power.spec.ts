import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readPower } from './power';

function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'power-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const ps = 'sys/class/power_supply';

describe('readPower', () => {
  it('reads a battery that counts charge, with its health against when new', () => {
    const dir = root({
      [`${ps}/AC/type`]: 'Mains\n',
      [`${ps}/AC/online`]: '1\n',
      [`${ps}/BAT0/type`]: 'Battery\n',
      [`${ps}/BAT0/status`]: 'Full\n',
      [`${ps}/BAT0/capacity`]: '100\n',
      [`${ps}/BAT0/charge_now`]: '3554000\n',
      [`${ps}/BAT0/charge_full`]: '3554000\n',
      [`${ps}/BAT0/charge_full_design`]: '8947000\n',
      [`${ps}/BAT0/current_now`]: '1000\n',
      [`${ps}/BAT0/voltage_now`]: '8163000\n',
      [`${ps}/BAT0/voltage_min_design`]: '7600000\n',
      [`${ps}/BAT0/cycle_count`]: '0\n',
      [`${ps}/BAT0/model_name`]: 'DELL GD1JP65\n',
    });
    expect(readPower(dir)).toEqual({
      onMains: true,
      batteries: [
        {
          name: 'BAT0',
          model: 'DELL GD1JP65',
          status: 'Full',
          percent: 100,
          healthPercent: 39.7,
          nowWh: 27,
          fullWh: 27,
          designWh: 68,
          voltageV: 8.16,
          powerW: 0,
          cycles: null,
        },
      ],
    });
  });

  it('reads a battery that counts energy, drawing power while it discharges', () => {
    const dir = root({
      [`${ps}/ADP1/type`]: 'Mains\n',
      [`${ps}/ADP1/online`]: '0\n',
      [`${ps}/BAT1/type`]: 'Battery\n',
      [`${ps}/BAT1/status`]: 'Discharging\n',
      [`${ps}/BAT1/capacity`]: '64\n',
      [`${ps}/BAT1/energy_now`]: '32000000\n',
      [`${ps}/BAT1/energy_full`]: '50000000\n',
      [`${ps}/BAT1/energy_full_design`]: '57000000\n',
      [`${ps}/BAT1/power_now`]: '7360000\n',
      [`${ps}/BAT1/voltage_now`]: '11400000\n',
      [`${ps}/BAT1/cycle_count`]: '212\n',
    });
    expect(readPower(dir)).toEqual({
      onMains: false,
      batteries: [
        {
          name: 'BAT1',
          model: null,
          status: 'Discharging',
          percent: 64,
          healthPercent: 87.7,
          nowWh: 32,
          fullWh: 50,
          designWh: 57,
          voltageV: 11.4,
          powerW: -7.4,
          cycles: 212,
        },
      ],
    });
  });

  it('gives nothing for a host without a battery or a mains adapter', () => {
    expect(readPower(root({}))).toEqual({ onMains: null, batteries: [] });
    const usb = root({
      [`${ps}/hid-mouse/type`]: 'Battery\n',
      [`${ps}/hid-mouse/scope`]: 'Device\n',
    });
    expect(readPower(usb)).toEqual({ onMains: null, batteries: [] });
  });
});
