import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BMS_SOURCES, type BmsSource } from '../reading';

/** POST /api/inverter/profiles/:id/bms body. */
export class CreateBmsDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsIn(BMS_SOURCES)
  sourceType!: BmsSource;

  /** The reader's Bluetooth peripheral id, for reference. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bluetoothId?: string;
}
