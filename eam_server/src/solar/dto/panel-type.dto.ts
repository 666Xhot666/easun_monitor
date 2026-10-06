import {
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** A panel model's datasheet values at standard test conditions. */
export class PanelTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Rated power (Pmax), W. */
  @IsNumber()
  @IsPositive()
  maxPowerW!: number;

  /** Voltage at the maximum power point, V. */
  @IsNumber()
  @IsPositive()
  vmpV!: number;

  /** Current at the maximum power point, A. */
  @IsNumber()
  @IsPositive()
  impA!: number;

  /** Open-circuit voltage, V. */
  @IsNumber()
  @IsPositive()
  vocV!: number;

  /** Short-circuit current, A. */
  @IsNumber()
  @IsPositive()
  iscA!: number;
}
