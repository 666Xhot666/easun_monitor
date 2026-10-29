import { Transform } from 'class-transformer';
import {
  COMMON_READINGS,
  type CommonReading,
} from '../readings/common-readings';
import {
  IsArray,
  IsIn,
  IsDate,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** GET /api/inverter/:profileId/history query string. */
export class HistoryQueryDto {
  /** Range start (ISO 8601). Defaults to one hour before `to`. */
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  @IsDate()
  from?: Date;

  /** Range end (ISO 8601). Defaults to now. */
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  @IsDate()
  to?: Date;

  /** Maximum number of points to return. */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(2000)
  points?: number;

  /** Comma-separated register names; all numeric registers when omitted. */
  @IsOptional()
  @Transform(({ value }) => String(value).split(',').filter(Boolean))
  @IsArray()
  @Matches(/^[A-Za-z0-9]+$/, { each: true })
  fields?: string[];

  /**
   * Comma-separated common readings (pvPower, batteryPower, ...): the
   * points then carry them by those names. Not with `fields`.
   */
  @IsOptional()
  @Transform(({ value }) => String(value).split(',').filter(Boolean))
  @IsArray()
  @IsIn(COMMON_READINGS, { each: true })
  readings?: CommonReading[];
}
