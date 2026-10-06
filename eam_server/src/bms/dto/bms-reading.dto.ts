import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BMS_PROTOCOLS, type BmsProtocol } from '../jk/variants';
import { BMS_SOURCES, type BmsReading, type BmsSource } from '../reading';

/** Plausible limits: up to 32 LiFePO4 cells, a few hundred amperes. */
const MAX_PACK_V = 150;
const MAX_CURRENT_A = 1000;
const MAX_CELL_V = 5;
const MAX_CELLS = 32;

class BmsTemperatureDto {
  @IsString()
  @MaxLength(8)
  name!: string;

  @IsNumber()
  @Min(-60)
  @Max(150)
  celsius!: number;
}

/**
 * POST /api/bms/ingest body: one normalized BmsReading. Optional fields may
 * be null (a variant that does not provide them), never out of range.
 */
export class BmsReadingDto implements BmsReading {
  @IsISO8601({ strict: true })
  timestamp!: string;

  @IsIn(BMS_SOURCES)
  source!: BmsSource;

  @IsIn(BMS_PROTOCOLS)
  protocol!: BmsProtocol;

  @IsString()
  @MaxLength(40)
  decoderVersion!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_PACK_V)
  packVoltageV!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-MAX_CURRENT_A)
  @Max(MAX_CURRENT_A)
  currentA!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-MAX_PACK_V * MAX_CURRENT_A)
  @Max(MAX_PACK_V * MAX_CURRENT_A)
  powerW!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  stateOfChargePct!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  remainingCapacityAh!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  nominalCapacityAh!: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  cycleCount!: number | null;

  @IsArray()
  @ArrayMaxSize(MAX_CELLS)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(MAX_CELL_V, { each: true })
  cellVoltagesV!: number[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_CELL_V)
  cellMinV!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_CELL_V)
  cellMaxV!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_CELL_V)
  cellAverageV!: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_CELL_V)
  cellDeltaV!: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CELLS)
  cellMinIndex!: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CELLS)
  cellMaxIndex!: number | null;

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => BmsTemperatureDto)
  temperaturesC!: BmsTemperatureDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(0xffff)
  temperatureSensorMask!: number | null;

  @IsOptional()
  @IsBoolean()
  balancing!: boolean | null;

  @IsOptional()
  @IsNumber()
  @Min(-10)
  @Max(10)
  balanceCurrentA!: number | null;

  @IsOptional()
  @IsBoolean()
  chargeMosfetOn!: boolean | null;

  @IsOptional()
  @IsBoolean()
  dischargeMosfetOn!: boolean | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(0xffffffff)
  alarmMask!: number | null;

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  alarms!: string[];
}
