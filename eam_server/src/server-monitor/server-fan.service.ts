import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FanSettings } from '../server-agent/fan/fan-control';
import type { HostSample } from '../server-agent/sample';
import { ServerAccessService } from './server-access.service';

/** Until the owner chooses: the firmware runs the fan; one rule ready for AUTO. */
export const DEFAULT_FAN_SETTINGS: FanSettings = {
  mode: 'FIRMWARE',
  minPercent: 0,
  manualPercent: 100,
  rules: [{ aboveC: 80, percent: 100 }],
};

const MODES = ['FIRMWARE', 'AUTO', 'MANUAL'] as const;
const MAX_RULES = 10;
const MAX_C = 120;

const isPercent = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;

/** The owner's settings, checked; the rules sorted by temperature. */
export function parseFanSettings(body: unknown): FanSettings {
  const bad = (what: string): never => {
    throw new BadRequestException(what);
  };
  if (typeof body !== 'object' || body === null)
    bad('Expected the fan settings');
  const o = body as Record<string, unknown>;
  if (!MODES.includes(o.mode as (typeof MODES)[number])) {
    bad('mode must be FIRMWARE, AUTO or MANUAL');
  }
  if (!isPercent(o.minPercent))
    bad('minPercent must be a whole number from 0 to 100');
  if (!isPercent(o.manualPercent))
    bad('manualPercent must be a whole number from 0 to 100');
  if (!Array.isArray(o.rules) || o.rules.length > MAX_RULES) {
    bad(`rules must be a list of at most ${MAX_RULES}`);
  }
  const rules = (o.rules as unknown[]).map((r) => {
    const rule = (typeof r === 'object' && r !== null ? r : {}) as Record<
      string,
      unknown
    >;
    const { aboveC, percent } = rule;
    if (
      typeof aboveC !== 'number' ||
      !Number.isFinite(aboveC) ||
      aboveC < 0 ||
      aboveC > MAX_C
    ) {
      bad(`Each rule's temperature must be from 0 to ${MAX_C} °C`);
    }
    if (!isPercent(percent))
      bad("Each rule's speed must be a whole number from 0 to 100");
    return { aboveC: aboveC as number, percent: percent as number };
  });
  rules.sort((a, b) => a.aboveC - b.aboveC);
  if (rules.some((r, i) => i > 0 && r.aboveC === rules[i - 1].aboveC)) {
    bad('Two rules have the same temperature');
  }
  return {
    mode: o.mode as FanSettings['mode'],
    minPercent: o.minPercent as number,
    manualPercent: o.manualPercent as number,
    rules,
  };
}

/** The host's fan settings, kept for the agent, and its last report on the fan. */
@Injectable()
export class ServerFanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ServerAccessService,
  ) {}

  /** What the agent is to do with the fan. */
  async settings(): Promise<FanSettings> {
    const row = await this.prisma.serverFanSettings.findUnique({
      where: { id: 1 },
    });
    if (!row) return DEFAULT_FAN_SETTINGS;
    return {
      mode: row.mode,
      minPercent: row.minPercent,
      manualPercent: row.manualPercent,
      rules: row.rules as FanSettings['rules'],
    };
  }

  async get(userId: number) {
    await this.access.requireViewer(userId);
    const [settings, latest] = await Promise.all([
      this.settings(),
      this.prisma.serverSample.findFirst({ orderBy: { at: 'desc' } }),
    ]);
    const sample = latest?.data as unknown as HostSample | undefined;
    return { settings, state: sample?.fanControl ?? null };
  }

  async put(ownerId: number, body: unknown): Promise<FanSettings> {
    await this.access.requireOwner(ownerId);
    const settings = parseFanSettings(body);
    const data = {
      ...settings,
      rules: settings.rules as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.serverFanSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    return settings;
  }
}
