import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** PATCH /api/inverter/profiles/:id/bms/:bmsId body. */
export class UpdateBmsDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  /** Use this BMS's live values for the battery in the energy flow. */
  @IsOptional()
  @IsBoolean()
  useForEnergyFlow?: boolean;
}
