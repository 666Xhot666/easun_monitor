/** A stored poll result, as returned by GET /api/inverter/:profileId/latest. */
export interface LatestReading {
  id: number;
  /** When the server polled it (ISO 8601). */
  timestamp: string;
  /** Register name -> value (enum registers hold their option index). */
  payload: Record<string, number>;
  /** Active fault and warning descriptions, decoded by the server. */
  alerts?: { faults: string[]; warnings: string[] };
}

/** One register, as served by GET /api/inverter/registers. */
export interface RegisterDefinition {
  name: string;
  label: string;
  address: number;
  type: 'uint16' | 'int16' | 'uint32';
  scale?: number;
  unit?: string;
  options?: readonly string[];
  group: 'telemetry' | 'settings' | 'status';
  writable?: boolean;
  min?: number;
  max?: number;
  /** The only values a numeric setting accepts (e.g. 220/230/240 V). */
  choices?: readonly number[];
  /** What the setting does, in the manual's terms. */
  description?: string;
  /** What each enum option does, indexed like `options`. */
  optionDescriptions?: readonly string[];
  /** The inverter's LCD setting program ("01"-"46"), if it has one. */
  panelProgram?: string;
  /** What can go wrong when this setting is changed (risky settings only). */
  risk?: string;
  /** Factory default (enum: option index). */
  default?: number;
  /** Factory default by nominal battery voltage (12/24/48 V). */
  defaultByBatteryVoltage?: Readonly<Record<number, number>>;
}

/** A setting only the inverter's own panel can change, as served by
 * GET /api/inverter/panel-settings. */
export interface PanelSetting {
  program: string;
  title: string;
  description: string;
  options?: readonly string[];
  default: string;
  /** Settings registers whose effect depends on this one. */
  affects?: readonly string[];
}
