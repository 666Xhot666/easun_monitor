import {
  IsBoolean,
  IsNumber,
  IsOptional,
  Max,
  Min,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_CELL_LOW_ALERT_V, MIN_CELL_LOW_ALERT_V } from '../constants';

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

  /**
   * The lowest-cell voltage this BMS is alerted at while off-grid; null: a little above the BMS's own undervoltage recovery.
   */
  @IsOptional()
  @IsNumber()
  @Min(MIN_CELL_LOW_ALERT_V)
  @Max(MAX_CELL_LOW_ALERT_V)
  cellLowAlertV?: number | null;
}
