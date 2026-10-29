/**
 * A device's description files (registers, panel-only settings, settings
 * rules), checked when they are loaded: a mistake in one stops the server
 * at start with the file and the entry, instead of misreading the inverter.
 */
import {
  wordCount,
  type RegisterDefinition,
  type RegisterGroup,
  type RegisterType,
} from '../registers/register-map.ts';
import type { PanelSetting } from '../registers/smg-ii.panel-settings.ts';
import type { Bounds, SettingsRule } from '../settings-rules/settings-rules.ts';

const TYPES: readonly RegisterType[] = ['uint16', 'int16', 'uint32', 'ascii'];
const GROUPS: readonly RegisterGroup[] = [
  'telemetry',
  'settings',
  'status',
  'command',
  'info',
];

// Type-erasable TypeScript only (no parameter properties): the simulator
// loads this file with Node's type stripping.
class Place {
  readonly file: string;
  readonly path: string;
  constructor(file: string, path: string) {
    this.file = file;
    this.path = path;
  }
  at(key: string | number): Place {
    return new Place(
      this.file,
      typeof key === 'number' ? `${this.path}[${key}]` : `${this.path}.${key}`,
    );
  }
  fail(what: string): never {
    throw new Error(`${this.file}: ${this.path}: ${what}`);
  }
}

type Json = Record<string, unknown>;

function object(v: unknown, p: Place): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    p.fail('expected an object');
  return v as Json;
}
function list(v: unknown, p: Place): unknown[] {
  if (!Array.isArray(v)) p.fail('expected a list');
  return v as unknown[];
}
function text(v: unknown, p: Place): string {
  if (typeof v !== 'string' || v === '') p.fail('expected a text');
  return v as string;
}
function num(v: unknown, p: Place): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) p.fail('expected a number');
  return v as number;
}
function texts(v: unknown, p: Place): string[] {
  return list(v, p).map((x, i) => text(x, p.at(i)));
}
function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  p: Place,
): T {
  if (!allowed.includes(v as T))
    p.fail(`expected one of ${allowed.join(', ')}`);
  return v as T;
}

/** Keys of `o` other than `known`: a typo there would silently do nothing. */
function noOthers(o: Json, known: readonly string[], p: Place): void {
  const other = Object.keys(o).find((k) => !known.includes(k));
  if (other) p.at(other).fail('not a known field');
}

const REGISTER_FIELDS = [
  'name',
  'label',
  'address',
  'type',
  'length',
  'scale',
  'unit',
  'options',
  'group',
  'writable',
  'verified',
  'min',
  'max',
  'choices',
  'description',
  'optionDescriptions',
  'panelProgram',
  'risk',
  'default',
  'defaultByBatteryVoltage',
  'bits',
  'note',
] as const;

function register(v: unknown, p: Place): RegisterDefinition {
  const o = object(v, p);
  const named =
    typeof o.name === 'string' ? new Place(p.file, `${p.path} (${o.name})`) : p;
  noOthers(o, REGISTER_FIELDS, named);
  const r: RegisterDefinition = {
    name: text(o.name, named.at('name')),
    label: text(o.label, named.at('label')),
    address: num(o.address, named.at('address')),
    type: oneOf(o.type, TYPES, named.at('type')),
    group: oneOf(o.group, GROUPS, named.at('group')),
  };
  if (!Number.isInteger(r.address) || r.address < 0 || r.address > 0xffff)
    named.at('address').fail('expected a register address (0-65535)');
  if (r.type === 'ascii' || o.length !== undefined) {
    const length = num(o.length, named.at('length'));
    if (!Number.isInteger(length) || length < 1)
      named.at('length').fail('expected a word count of at least 1');
    r.length = length;
  }
  for (const key of ['scale', 'min', 'max', 'default'] as const) {
    if (o[key] !== undefined) r[key] = num(o[key], named.at(key));
  }
  for (const key of [
    'unit',
    'description',
    'panelProgram',
    'risk',
    'note',
  ] as const) {
    if (o[key] !== undefined) r[key] = text(o[key], named.at(key));
  }
  for (const key of ['writable', 'verified'] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] !== 'boolean')
      named.at(key).fail('expected true or false');
    r[key] = o[key] as boolean;
  }
  if (o.options !== undefined)
    r.options = texts(o.options, named.at('options'));
  if (o.optionDescriptions !== undefined)
    r.optionDescriptions = texts(
      o.optionDescriptions,
      named.at('optionDescriptions'),
    );
  if (o.choices !== undefined)
    r.choices = list(o.choices, named.at('choices')).map((x, i) =>
      num(x, named.at('choices').at(i)),
    );
  if (o.defaultByBatteryVoltage !== undefined) {
    const byVoltage = object(
      o.defaultByBatteryVoltage,
      named.at('defaultByBatteryVoltage'),
    );
    r.defaultByBatteryVoltage = Object.fromEntries(
      Object.entries(byVoltage).map(([volts, value]) => [
        Number(volts),
        num(value, named.at('defaultByBatteryVoltage').at(volts)),
      ]),
    );
  }
  if (o.bits !== undefined) {
    const bits = object(o.bits, named.at('bits'));
    for (const bit of Object.keys(bits)) {
      if (!/^\d+$/.test(bit) || Number(bit) > 31)
        named.at('bits').at(bit).fail('expected a bit number (0-31)');
    }
    r.bits = Object.fromEntries(
      Object.entries(bits).map(([bit, meaning]) => [
        Number(bit),
        text(meaning, named.at('bits').at(bit)),
      ]),
    );
  }
  return r;
}

/** The registers of `json`, in file order; throws on the first problem. */
export function parseRegisterFile(
  json: unknown,
  file: string,
): RegisterDefinition[] {
  const root = new Place(file, 'registers');
  const items = list(object(json, new Place(file, '(file)')).registers, root);
  const registers = items.map((x, i) => register(x, root.at(i)));
  const byName = new Set<string>();
  for (const r of registers) {
    if (byName.has(r.name)) root.fail(`${r.name} is listed twice`);
    byName.add(r.name);
  }
  const sorted = [...registers].sort((a, b) => a.address - b.address);
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1];
    if (before.address + wordCount(before) > sorted[i].address)
      root.fail(
        `${sorted[i].name} at ${sorted[i].address} overlaps ${before.name} (${before.address}, ${wordCount(before)} words)`,
      );
  }
  return registers;
}

/** The panel-only settings of `json`. */
export function parsePanelSettingsFile(
  json: unknown,
  file: string,
): PanelSetting[] {
  const root = new Place(file, 'panelSettings');
  return list(object(json, new Place(file, '(file)')).panelSettings, root).map(
    (x, i) => {
      const p = root.at(i);
      const o = object(x, p);
      noOthers(
        o,
        ['program', 'title', 'description', 'options', 'default', 'affects'],
        p,
      );
      return {
        program: text(o.program, p.at('program')),
        title: text(o.title, p.at('title')),
        description: text(o.description, p.at('description')),
        default: text(o.default, p.at('default')),
        ...(o.options !== undefined && {
          options: texts(o.options, p.at('options')),
        }),
        ...(o.affects !== undefined && {
          affects: texts(o.affects, p.at('affects')),
        }),
      };
    },
  );
}

export interface SettingsRulesFile {
  /** Nominal battery voltage -> setting -> range. */
  voltageRanges: Record<number, Record<string, Bounds>>;
  currentRanges: Record<string, Bounds>;
  rules: SettingsRule[];
  inactiveRules: SettingsRule[];
  /** Only for a LiFePO4 battery. */
  lithiumRules: SettingsRule[];
}

function bounds(v: unknown, p: Place): Bounds {
  const o = object(v, p);
  noOthers(o, ['min', 'max'], p);
  return {
    ...(o.min !== undefined && { min: num(o.min, p.at('min')) }),
    ...(o.max !== undefined && { max: num(o.max, p.at('max')) }),
  };
}

/** The rules of `json`, every setting they name checked against `registers`. */
export function parseSettingsRulesFile(
  json: unknown,
  registers: readonly RegisterDefinition[],
  file: string,
): SettingsRulesFile {
  const o = object(json, new Place(file, '(file)'));
  const settings = new Set(
    registers.filter((r) => r.group === 'settings').map((r) => r.name),
  );
  const setting = (v: unknown, p: Place) => {
    const name = text(v, p);
    if (!settings.has(name))
      p.fail(`${name} is not a setting in the register map`);
    return name;
  };
  const ranges = (v: unknown, p: Place) =>
    Object.fromEntries(
      Object.entries(object(v, p)).map(([name, range]) => [
        setting(name, p.at(name)),
        bounds(range, p.at(name)),
      ]),
    );
  const voltageRanges = Object.fromEntries(
    Object.entries(
      object(o.voltageRanges, new Place(file, 'voltageRanges')),
    ).map(([volts, byName]) => [
      Number(volts),
      ranges(byName, new Place(file, `voltageRanges.${volts}`)),
    ]),
  );
  const rule = (v: unknown, p: Place): SettingsRule => {
    const r = object(v, p);
    const named =
      typeof r.id === 'string' ? new Place(p.file, `${p.path} (${r.id})`) : p;
    const common = {
      id: text(r.id, named.at('id')),
      key: text(r.key, named.at('key')),
      ...(r.note !== undefined && { note: text(r.note, named.at('note')) }),
    };
    const field = (key: string) => named.at(key);
    const known = (v: unknown, key: string) => {
      const name = text(v, field(key));
      if (!settings.has(name))
        named.fail(`${name} is not a setting in the register map`);
      return name;
    };
    switch (r.kind) {
      case 'compare':
        noOthers(
          r,
          [
            'id',
            'key',
            'kind',
            'severity',
            'left',
            'op',
            'right',
            'offset',
            'message',
            'note',
          ],
          named,
        );
        return {
          ...common,
          kind: 'compare',
          severity: oneOf(
            r.severity,
            ['error', 'warning'] as const,
            field('severity'),
          ),
          left: known(r.left, 'left'),
          op: oneOf(r.op, ['>', '>=', '<='] as const, field('op')),
          right: known(r.right, 'right'),
          ...(r.offset !== undefined && {
            offset: num(r.offset, field('offset')),
          }),
          message: text(r.message, field('message')),
        };
      case 'inactive':
        noOthers(
          r,
          ['id', 'key', 'kind', 'settings', 'when', 'in', 'reason', 'note'],
          named,
        );
        return {
          ...common,
          kind: 'inactive',
          settings: list(r.settings, field('settings')).map((s) =>
            known(s, 'settings'),
          ),
          when: known(r.when, 'when'),
          in: list(r.in, field('in')).map((x, i) => num(x, field('in').at(i))),
          reason: text(r.reason, field('reason')),
        };
      case 'avoid':
        noOthers(
          r,
          ['id', 'key', 'kind', 'setting', 'value', 'message', 'note'],
          named,
        );
        return {
          ...common,
          kind: 'avoid',
          setting: known(r.setting, 'setting'),
          value: num(r.value, field('value')),
          message: text(r.message, field('message')),
        };
      default:
        return field('kind').fail('expected compare, inactive or avoid');
    }
  };
  const rules = (key: string) =>
    list(o[key], new Place(file, key)).map((x, i) =>
      rule(x, new Place(file, key).at(i)),
    );
  return {
    voltageRanges,
    currentRanges: ranges(o.currentRanges, new Place(file, 'currentRanges')),
    rules: rules('rules'),
    inactiveRules: rules('inactiveRules'),
    lithiumRules: rules('lithiumRules'),
  };
}
