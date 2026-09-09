import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  HOST_ADDRESS_MESSAGE,
  HOST_ADDRESS_PATTERN,
} from '../../common/validators/host-address';
import { BatteryType } from '../../generated/prisma/enums';

export class SetupInverterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  // --- Step 1: network / connection ---------------------------------
  @IsString()
  @Matches(HOST_ADDRESS_PATTERN, { message: HOST_ADDRESS_MESSAGE })
  ipAddress!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  // --- Step 2: inverter model / power rating -------------------------
  @IsInt()
  @IsPositive()
  ratedPowerWatts!: number;

  // --- Step 3: battery bank specs -------------------------------------
  @IsNumber()
  @IsPositive()
  batteryNominalVoltage!: number;

  @IsNumber()
  @IsPositive()
  batteryCapacityAh!: number;

  @IsEnum(BatteryType, {
    message: `batteryType must be one of: ${Object.values(BatteryType).join(', ')}`,
  })
  batteryType!: BatteryType;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  lowBatteryCutoffVoltage?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  bulkChargeVoltage?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  floatChargeVoltage?: number;
}
