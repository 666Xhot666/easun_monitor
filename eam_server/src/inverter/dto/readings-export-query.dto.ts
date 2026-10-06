import { Transform } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

/** GET /api/inverter/:profileId/readings/export query string. */
export class ReadingsExportQueryDto {
  /** Range start (ISO 8601), inclusive. */
  @Transform(({ value }) => new Date(value))
  @IsDate()
  from!: Date;

  /** Range end (ISO 8601), exclusive. */
  @Transform(({ value }) => new Date(value))
  @IsDate()
  to!: Date;

  /** IANA time zone for the Time column, e.g. Europe/Rome. Defaults to UTC. */
  @IsOptional()
  @IsString()
  tz?: string;
}
