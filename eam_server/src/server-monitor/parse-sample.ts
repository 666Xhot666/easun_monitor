import { BadRequestException } from '@nestjs/common';
import type { HostSample } from '../server-agent/sample';

/** Lists longer than this are not a real host's; the sample is refused. */
const MAX_ITEMS = 256;
const MAX_TEXT = 200;

class Shape {
  constructor(readonly path: string) {}
  fail(what: string): never {
    throw new BadRequestException(`${this.path}: ${what}`);
  }
}

function object(v: unknown, s: Shape): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    s.fail('expected an object');
  return v as Record<string, unknown>;
}
function num(v: unknown, s: Shape, min = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min)
    s.fail(`expected a number ≥ ${min}`);
  return v as number;
}
function numOrNull(v: unknown, s: Shape, min = 0): number | null {
  return v === null ? null : num(v, s, min);
}
function textOrNull(v: unknown, s: Shape): string | null {
  return v === null ? null : text(v, s);
}
function boolOrNull(v: unknown, s: Shape): boolean | null {
  if (v !== null && typeof v !== 'boolean')
    s.fail('expected true, false or null');
  return v as boolean | null;
}
function text(v: unknown, s: Shape): string {
  if (typeof v !== 'string' || v.length > MAX_TEXT)
    s.fail('expected a short text');
  return v as string;
}
function list<T>(v: unknown, s: Shape, item: (x: unknown, s: Shape) => T): T[] {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) s.fail('expected a list');
  return (v as unknown[]).map((x, i) => item(x, new Shape(`${s.path}[${i}]`)));
}
function listOrNull<T>(
  v: unknown,
  s: Shape,
  item: (x: unknown, s: Shape) => T,
): T[] | null {
  return v === null || v === undefined ? null : list(v, s, item);
}
const at = (s: Shape, key: string) => new Shape(`${s.path}.${key}`);

function fanControl(v: unknown, s: Shape): HostSample['fanControl'] {
  if (v === null || v === undefined) return null;
  const o = object(v, s);
  if (o.mode !== 'firmware' && o.mode !== 'manual')
    at(s, 'mode').fail('expected firmware or manual');
  return {
    mode: o.mode as 'firmware' | 'manual',
    percent: numOrNull(o.percent, at(s, 'percent')),
    pwm: numOrNull(o.pwm, at(s, 'pwm')),
    steps: numOrNull(o.steps, at(s, 'steps')),
    error: o.error === null ? null : text(o.error, at(s, 'error')),
  };
}

function updates(v: unknown, s: Shape): HostSample['updates'] {
  const o = object(v, s);
  const checkedAt = text(o.checkedAt, at(s, 'checkedAt'));
  if (Number.isNaN(Date.parse(checkedAt)))
    at(s, 'checkedAt').fail('expected a time');
  const lists =
    o.listsUpdatedAt === null
      ? null
      : text(o.listsUpdatedAt, at(s, 'listsUpdatedAt'));
  if (lists !== null && Number.isNaN(Date.parse(lists)))
    at(s, 'listsUpdatedAt').fail('expected a time');
  if (typeof o.rebootRequired !== 'boolean')
    at(s, 'rebootRequired').fail('expected true or false');
  return {
    checkedAt,
    packages: num(o.packages, at(s, 'packages')),
    security: num(o.security, at(s, 'security')),
    names: list(o.names, at(s, 'names'), text),
    listsUpdatedAt: lists,
    rebootRequired: o.rebootRequired as boolean,
  };
}

/** What a service or container takes; older agents send none of it. */
function usage(o: Record<string, unknown>, s: Shape) {
  return {
    ...(o.memoryBytes !== undefined && {
      memoryBytes: numOrNull(o.memoryBytes, at(s, 'memoryBytes')),
    }),
    ...(o.cpuPercent !== undefined && {
      cpuPercent: numOrNull(o.cpuPercent, at(s, 'cpuPercent')),
    }),
    ...(o.diskBytes !== undefined && {
      diskBytes: numOrNull(o.diskBytes, at(s, 'diskBytes')),
    }),
  };
}

function power(v: unknown, s: Shape): NonNullable<HostSample['power']> {
  const o = object(v, s);
  return {
    onMains: boolOrNull(o.onMains, at(s, 'onMains')),
    batteries: list(o.batteries, at(s, 'batteries'), (x, b) => {
      const battery = object(x, b);
      const n = (key: string, min = 0) =>
        numOrNull(battery[key], at(b, key), min);
      return {
        name: text(battery.name, at(b, 'name')),
        model: textOrNull(battery.model, at(b, 'model')),
        status: textOrNull(battery.status, at(b, 'status')),
        percent: n('percent'),
        healthPercent: n('healthPercent'),
        nowWh: n('nowWh'),
        fullWh: n('fullWh'),
        designWh: n('designWh'),
        voltageV: n('voltageV'),
        // Below zero while discharging.
        powerW: n('powerW', -Infinity),
        cycles: n('cycles'),
      };
    }),
  };
}

/** The agent's sample, checked field by field; anything else is refused (400). */
export function parseHostSample(body: unknown): HostSample {
  const s = new Shape('sample');
  const o = object(body, s);
  const when = text(o.at, at(s, 'at'));
  if (Number.isNaN(Date.parse(when))) at(s, 'at').fail('expected a time');

  const cpuS = at(s, 'cpu');
  const cpu = object(o.cpu, cpuS);
  const load = list(cpu.load, at(cpuS, 'load'), num);
  if (load.length !== 3) at(cpuS, 'load').fail('expected 3 numbers');

  const memS = at(s, 'memory');
  const memory = object(o.memory, memS);

  return {
    at: new Date(when).toISOString(),
    uptimeSeconds: num(o.uptimeSeconds, at(s, 'uptimeSeconds')),
    cpu: {
      usagePercent: numOrNull(cpu.usagePercent, at(cpuS, 'usagePercent')),
      coresPercent: list(cpu.coresPercent, at(cpuS, 'coresPercent'), num),
      load: load as [number, number, number],
    },
    memory: {
      totalBytes: num(memory.totalBytes, at(memS, 'totalBytes')),
      availableBytes: num(memory.availableBytes, at(memS, 'availableBytes')),
      swapTotalBytes: num(memory.swapTotalBytes, at(memS, 'swapTotalBytes')),
      swapFreeBytes: num(memory.swapFreeBytes, at(memS, 'swapFreeBytes')),
    },
    disks: list(o.disks, at(s, 'disks'), (x, d) => {
      const disk = object(x, d);
      return {
        mount: text(disk.mount, at(d, 'mount')),
        totalBytes: num(disk.totalBytes, at(d, 'totalBytes')),
        freeBytes: num(disk.freeBytes, at(d, 'freeBytes')),
      };
    }),
    network: list(o.network, at(s, 'network'), (x, n) => {
      const net = object(x, n);
      return {
        name: text(net.name, at(n, 'name')),
        rxBytesPerSecond: numOrNull(
          net.rxBytesPerSecond,
          at(n, 'rxBytesPerSecond'),
        ),
        txBytesPerSecond: numOrNull(
          net.txBytesPerSecond,
          at(n, 'txBytesPerSecond'),
        ),
      };
    }),
    temperatures: list(o.temperatures, at(s, 'temperatures'), (x, t) => {
      const temp = object(x, t);
      return {
        device: text(temp.device, at(t, 'device')),
        label: text(temp.label, at(t, 'label')),
        // Below zero only when broken, but a reading is a reading.
        celsius: num(temp.celsius, at(t, 'celsius'), -100),
      };
    }),
    fans: list(o.fans, at(s, 'fans'), (x, f) => {
      const fan = object(x, f);
      return {
        device: text(fan.device, at(f, 'device')),
        label: text(fan.label, at(f, 'label')),
        rpm: num(fan.rpm, at(f, 'rpm')),
      };
    }),
    services: listOrNull(o.services, at(s, 'services'), (x, v) => {
      const service = object(x, v);
      if (typeof service.active !== 'boolean')
        at(v, 'active').fail('expected true or false');
      return {
        name: text(service.name, at(v, 'name')),
        active: service.active as boolean,
        ...usage(service, v),
      };
    }),
    ...(o.power != null && { power: power(o.power, at(s, 'power')) }),
    ...(o.updates != null && {
      updates: updates(o.updates, at(s, 'updates')),
    }),
    // Only an agent controlling a fan reports on it.
    ...(o.fanControl != null && {
      fanControl: fanControl(o.fanControl, at(s, 'fanControl')),
    }),
    containers: listOrNull(o.containers, at(s, 'containers'), (x, c) => {
      const container = object(x, c);
      return {
        name: text(container.name, at(c, 'name')),
        state: text(container.state, at(c, 'state')),
        status: text(container.status, at(c, 'status')),
        ...usage(container, c),
      };
    }),
  };
}
