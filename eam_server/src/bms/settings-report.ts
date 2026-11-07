import type { BmsSettings } from './jk/settings';
import type { BmsProtocol } from './jk/variants';

/** What a producer sends when the BMS reports its settings. */
export interface BmsSettingsReport {
  /** When the settings frame was received (ISO 8601). */
  timestamp: string;
  protocol: BmsProtocol;
  decoderVersion: string;
  settings: BmsSettings;
}
