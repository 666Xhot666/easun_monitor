import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_WIRING_DAYS, MAX_WIRING_DAYS } from '../constants';

/**
 * GET .../bms/:bmsId/wiring query: how many days back to fit.
 */
export class WiringQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WIRING_DAYS)
  days: number = DEFAULT_WIRING_DAYS;
}
