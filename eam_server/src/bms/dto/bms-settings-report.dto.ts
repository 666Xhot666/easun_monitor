import { IsIn, IsISO8601, IsString, MaxLength } from 'class-validator';
import { BMS_PROTOCOLS, type BmsProtocol } from '../jk/variants';
import type { BmsSettings } from '../jk/settings';
import { IsFlatSettings } from './is-flat-settings';
import type { BmsSettingsReport } from '../settings-report';

/**
 * POST /api/bms/ingest/settings body: the BMS's settings as the reader decoded them from a settings frame.
 */
export class BmsSettingsReportDto implements BmsSettingsReport {
  @IsISO8601({ strict: true })
  timestamp!: string;

  @IsIn(BMS_PROTOCOLS)
  protocol!: BmsProtocol;

  @IsString()
  @MaxLength(40)
  decoderVersion!: string;

  @IsFlatSettings()
  settings!: BmsSettings;
}
