import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /api/inverter/:profileId/alerts query string. */
export class AlertsQueryDto {
  /** Page size. */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** Only alerts recorded before this one: the last id of the previous page. */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  before?: number;
}
