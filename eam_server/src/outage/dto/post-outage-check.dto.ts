import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const CHECK_OUTCOMES = [
  'ok',
  'challenge',
  'rejected',
  'shape',
  'server',
  'network',
] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** POST /api/outage/reader/checks body: one check of the site. The nested parts are checked by the service. */
export class PostOutageCheckDto {
  /** When the reader made the check. */
  @IsISO8601({ strict: true })
  checkedAt!: string;

  @IsIn(CHECK_OUTCOMES)
  outcome!: CheckOutcome;

  @IsBoolean()
  usedBrowser!: boolean;

  /** Why the check failed, when it did. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;

  /** Required when ok: { found: false } or { found: true, groups, outage }. */
  @IsOptional()
  @IsObject()
  house?: unknown;

  /** When ok: { group: { "1".."7": [24 statuses] } } for the house's groups. */
  @IsOptional()
  @IsObject()
  weekly?: unknown;

  /** When ok: { updated, days: { "YYYY-MM-DD": { group: [24 statuses] } } }. */
  @IsOptional()
  @IsObject()
  confirmed?: unknown;
}
