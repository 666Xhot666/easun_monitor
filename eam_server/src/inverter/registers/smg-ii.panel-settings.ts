/**
 * SMG-II settings that exist only on the inverter's own panel: LCD setting
 * programs (and options of programs) with no register in the vendor
 * protocol, so the app can neither read nor write them. Listed so the
 * settings page can say they exist and what they change. From the manual
 * (docs/smg-ii-manual-settings.json), in devices/smg-ii/panel-settings.json.
 */
import file from '../devices/smg-ii/panel-settings.json';
import { parsePanelSettingsFile } from '../devices/device-files.ts';

export interface PanelSetting {
  /** LCD setting program number. */
  program: string;
  title: string;
  description: string;
  /** Options on the panel, if it is a choice. */
  options?: readonly string[];
  /** Panel default. */
  default: string;
  /** Settings registers whose effect depends on this one. */
  affects?: readonly string[];
}

export const SMG_II_PANEL_SETTINGS: readonly PanelSetting[] =
  parsePanelSettingsFile(file, 'devices/smg-ii/panel-settings.json');
