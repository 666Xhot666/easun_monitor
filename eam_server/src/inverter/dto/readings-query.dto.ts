import { Transform } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /api/inverter/:profileId/readings query string. */
export class ReadingsQueryDto {
  /** Range start (ISO 8601), inclusive. */
  @Transform(({ value }) => new Date(value))
  @IsDate()
  from!: Date;

  /** Range end (ISO 8601), exclusive. */
  @Transform(({ value }) => new Date(value))
  @IsDate()
  to!: Date;

  /** Page size. */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  /** Only readings older than this: the last timestamp of the previous page. */
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  @IsDate()
  before?: Date;
}
