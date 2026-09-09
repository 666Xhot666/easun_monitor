import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  MaxLength,
  Matches,
  Min,
  MinLength,
  Max,
  IsString,
} from 'class-validator';
import {
  HOST_ADDRESS_MESSAGE,
  HOST_ADDRESS_PATTERN,
} from '../../common/validators/host-address';
import { BatteryType } from '../../generated/prisma/enums';

/**
 * Every field optional — a PATCH only needs to send what actually
 * changed (renaming a profile, correcting an IP, tweaking a voltage
 * threshold), not the full setup payload again.
 */
export class UpdateInverterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(HOST_ADDRESS_PATTERN, { message: HOST_ADDRESS_MESSAGE })
  ipAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  ratedPowerWatts?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  batteryNominalVoltage?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  batteryCapacityAh?: number;

  @IsOptional()
  @IsEnum(BatteryType, {
    message: `batteryType must be one of: ${Object.values(BatteryType).join(', ')}`,
  })
  batteryType?: BatteryType;

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
