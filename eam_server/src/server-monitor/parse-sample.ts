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
function numOrNull(v: unknown, s: Shape): number | null {
  return v === null ? null : num(v, s);
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
      };
    }),
    containers: listOrNull(o.containers, at(s, 'containers'), (x, c) => {
      const container = object(x, c);
      return {
        name: text(container.name, at(c, 'name')),
        state: text(container.state, at(c, 'state')),
        status: text(container.status, at(c, 'status')),
      };
    }),
  };
}
