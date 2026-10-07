import { IsBoolean, IsObject, IsOptional } from 'class-validator';

/** PUT /api/notifications/settings: any part of the settings; the rest stays. */
export class UpdateNotificationSettingsDto {
  /** Per kind, `{ inApp?, telegram? }`; unknown kinds are ignored. */
  @IsOptional()
  @IsObject()
  channels?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  quietHours?: boolean;
}
