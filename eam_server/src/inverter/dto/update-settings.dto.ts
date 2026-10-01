import { IsBoolean, IsObject, IsOptional } from 'class-validator';

/** PATCH /api/inverter/:profileId/settings body. */
export class UpdateSettingsDto {
  /** Settings register name -> new real value (enum: option index). */
  @IsObject()
  changes!: Record<string, number>;

  /** Write even if the changes raise settings-rule warnings. */
  @IsOptional()
  @IsBoolean()
  acknowledgeWarnings?: boolean;
}
