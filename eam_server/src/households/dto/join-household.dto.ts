import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /api/households/join body. */
export class JoinHouseholdDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  code!: string;
}
