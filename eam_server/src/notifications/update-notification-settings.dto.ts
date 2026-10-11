import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { OUTAGE_LEAD_MINUTES } from './notification-settings';

/** PUT /api/notifications/settings: any part of the settings; the rest stays. */
export class UpdateNotificationSettingsDto {
  /** Per kind, `{ inApp?, telegram? }`; unknown kinds are ignored. */
  @IsOptional()
  @IsObject()
  channels?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  quietHours?: boolean;

  @IsOptional()
  @IsInt()
  @Min(OUTAGE_LEAD_MINUTES.min)
  @Max(OUTAGE_LEAD_MINUTES.max)
  outageLeadMinutes?: number;

  @IsOptional()
  @IsBoolean()
  possibleOutages?: boolean;
}
