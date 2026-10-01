/**
 * The Register map: everything the app knows about the inverter's
 * registers (name, address, width, signedness, scale, unit, enum options,
 * group, writability, documented range) and how to turn register words
 * into readings and back.
 *
 * The poller, the settings writer and the simulator all go through this
 * module, and the frontend receives its definitions as metadata, so a
 * register is described exactly once (see smg-ii.registers.ts).
 *
 * No imports and only type-erasable TypeScript, so the simulator can load
 * it with Node's type stripping.
 */

export type RegisterType = 'uint16' | 'int16' | 'uint32';

/**
 * telemetry: live measurements, polled every cycle.
 * settings: configuration, read on demand and on a slow cadence.
 * status: fault and warning bitfields, polled with telemetry.
 */
export type RegisterGroup = 'telemetry' | 'settings' | 'status';

export interface RegisterDefinition {
  /** Stable key, used in stored readings and by the frontend. */
  name: string;
  /** Human-readable name for the UI. */
  label: string;
  /** Decimal register address, as in the vendor protocol document. */
  address: number;
  type: RegisterType;
  /** real value = raw * scale (default 1). */
  scale?: number;
  unit?: string;
  /** Enum labels indexed by raw value; present for enum registers. */
  options?: readonly string[];
  group: RegisterGroup;
  writable?: boolean;
  /** Documented bounds, in real (scaled) units. */
  min?: number;
  max?: number;
  /** The only real values a numeric setting accepts (e.g. 220/230/240 V). */
  choices?: readonly number[];
  /** For bitfield registers (fault/warning codes): bit index -> meaning. */
  bits?: Readonly<Record<number, string>>;
}

/** A contiguous run of registers fetched with one read request. */
export interface RegisterBlock {
  address: number;
  count: number;
}

/** A decoded poll result: register name -> real value (enum = raw index). */
export type Reading = Record<string, number>;

export class RegisterValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterValueError';
  }
}

/** Unused addresses a single read may span rather than splitting in two. */
const MAX_BRIDGED_GAP = 8;
/** Modbus limit on registers per read. */
const MAX_BLOCK = 125;

export class RegisterMap {
  private readonly byName = new Map<string, RegisterDefinition>();
  private readonly definitions: readonly RegisterDefinition[];

  constructor(definitions: readonly RegisterDefinition[]) {
    this.definitions = [...definitions].sort((a, b) => a.address - b.address);
    for (let i = 0; i < this.definitions.length; i++) {
      const definition = this.definitions[i];
      if (this.byName.has(definition.name)) {
        throw new Error(`Register map: duplicate register name ${definition.name}`);
      }
      this.byName.set(definition.name, definition);
      const previous = this.definitions[i - 1];
      if (previous && previous.address + wordCount(previous) > definition.address) {
        throw new Error(
          `Register map: ${previous.name} (${previous.address}) overlaps ${definition.name} (${definition.address})`,
        );
      }
    }
  }

  get(name: string): RegisterDefinition | undefined {
    return this.byName.get(name);
  }

  /** Definitions in address order, optionally restricted to one group. */
  list(group?: RegisterGroup): RegisterDefinition[] {
    return this.definitions.filter((d) => group === undefined || d.group === group);
  }

  /** The fewest read requests that cover every register of a group. */
  blocks(group: RegisterGroup): RegisterBlock[] {
    const blocks: RegisterBlock[] = [];
    for (const definition of this.list(group)) {
      const end = definition.address + wordCount(definition);
      const current = blocks[blocks.length - 1];
      const currentEnd = current ? current.address + current.count : 0;
      if (
        current &&
        definition.address - currentEnd <= MAX_BRIDGED_GAP &&
        end - current.address <= MAX_BLOCK
      ) {
        current.count = end - current.address;
      } else {
        blocks.push({ address: definition.address, count: end - definition.address });
      }
    }
    return blocks;
  }

  /** Decodes the raw words of one block into named real values. */
  decodeBlock(block: RegisterBlock, words: readonly number[]): Reading {
    const reading: Reading = {};
    for (const definition of this.definitions) {
      const offset = definition.address - block.address;
      if (offset < 0 || offset + wordCount(definition) > block.count) continue;
      reading[definition.name] = decode(definition, words.slice(offset, offset + wordCount(definition)));
    }
    return reading;
  }

  /** Labels of the bits set in a bitfield register's value, lowest bit
   * first; an undocumented bit is reported as "Code n". */
  activeFlags(name: string, value: number): string[] {
    const bits = this.byName.get(name)?.bits ?? {};
    const flags: string[] = [];
    for (let bit = 0; bit < 32; bit++) {
      if (Math.floor(value / 2 ** bit) % 2 === 1) {
        flags.push(bits[bit] ?? `Code ${bit}`);
      }
    }
    return flags;
  }

  /**
   * Validates a real value for a writable register and returns the raw
   * write it becomes. Throws RegisterValueError with a user-facing message.
   */
  encode(name: string, value: number): { address: number; values: number[] } {
    const definition = this.byName.get(name);
    if (!definition) throw new RegisterValueError(`Unknown register ${name}`);
    if (!definition.writable) throw new RegisterValueError(`${definition.label} is not writable`);
    if (!Number.isFinite(value)) throw new RegisterValueError(`${definition.label} must be a number`);

    if (definition.options) {
      if (!Number.isInteger(value) || value < 0 || value >= definition.options.length) {
        throw new RegisterValueError(`${value} is not a valid option for ${definition.label}`);
      }
      return { address: definition.address, values: [value] };
    }

    if (definition.choices && !definition.choices.includes(value)) {
      throw new RegisterValueError(
        `${definition.label} must be ${listChoices(definition.choices)}${definition.unit ? ` ${definition.unit}` : ''}`,
      );
    }

    if (
      (definition.min !== undefined && value < definition.min) ||
      (definition.max !== undefined && value > definition.max)
    ) {
      throw new RegisterValueError(
        `${definition.label} must be between ${definition.min ?? '-∞'} and ${definition.max ?? '∞'}`,
      );
    }

    const scale = definition.scale ?? 1;
    const raw = Math.round(value / scale);
    if (Math.abs(raw * scale - value) > scale / 1000) {
      throw new RegisterValueError(
        `${definition.label} has a resolution of ${scale}${definition.unit ? ` ${definition.unit}` : ''}`,
      );
    }
    return { address: definition.address, values: toWords(definition, raw) };
  }
}

/** [220, 230, 240] -> "220, 230 or 240". */
function listChoices(choices: readonly number[]): string {
  return choices.length < 2
    ? choices.join('')
    : `${choices.slice(0, -1).join(', ')} or ${choices[choices.length - 1]}`;
}

export function wordCount(definition: RegisterDefinition): number {
  return definition.type === 'uint32' ? 2 : 1;
}

function decode(definition: RegisterDefinition, words: readonly number[]): number {
  let raw: number;
  if (definition.type === 'uint32') {
    raw = words[0] * 0x10000 + words[1];
  } else if (definition.type === 'int16') {
    raw = words[0] > 0x7fff ? words[0] - 0x10000 : words[0];
  } else {
    raw = words[0];
  }
  const scale = definition.scale ?? 1;
  return scale === 1 ? raw : roundToScale(raw * scale, scale);
}

function toWords(definition: RegisterDefinition, raw: number): number[] {
  if (definition.type === 'uint32') {
    if (raw < 0 || raw > 0xffffffff) throw new RegisterValueError(`${definition.label} is out of range`);
    return [Math.floor(raw / 0x10000), raw % 0x10000];
  }
  const [low, high] = definition.type === 'int16' ? [-0x8000, 0x7fff] : [0, 0xffff];
  if (raw < low || raw > high) throw new RegisterValueError(`${definition.label} is out of range`);
  return [raw < 0 ? raw + 0x10000 : raw];
}

/** 230.50000000000003 -> 230.5, using the register's own resolution. */
function roundToScale(value: number, scale: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(scale)));
  return Number(value.toFixed(decimals));
}
