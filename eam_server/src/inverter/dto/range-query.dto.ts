import { Transform } from 'class-transformer';
import { IsDate } from 'class-validator';

/** A required time range: `from` inclusive, `to` exclusive (ISO 8601). */
export class RangeQueryDto {
  @Transform(({ value }) => new Date(value))
  @IsDate()
  from!: Date;

  @Transform(({ value }) => new Date(value))
  @IsDate()
  to!: Date;
}
