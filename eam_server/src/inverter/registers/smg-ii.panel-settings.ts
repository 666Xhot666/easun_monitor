/**
 * SMG-II settings that exist only on the inverter's own panel: LCD setting
 * programs (and options of programs) with no register in the vendor
 * protocol, so the app can neither read nor write them. Listed so the
 * settings page can say they exist and what they change. From the manual
 * (docs/smg-ii-manual-settings.json).
 */

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

export const SMG_II_PANEL_SETTINGS: readonly PanelSetting[] = [
  {
    program: '01',
    title: 'Output source priority: SUB priority',
    description: 'A fourth output priority on the panel: solar charges the battery first, then powers the loads, with utility helping when solar is not enough. The protocol has no value for it; if the panel is set to SUB, the page may show an unknown output priority.',
    default: 'Utility first',
    affects: ['OutputPriority'],
  },
  {
    program: '03',
    title: 'AC input voltage range: Generator',
    description: 'A third input range on the panel: accepts 90-280 VAC and is compatible with generators, whose unstable output may make the inverter output unstable too. The protocol has no value for it.',
    default: 'Appliances',
    affects: ['InputVoltageRange'],
  },
  {
    program: '05',
    title: 'Battery type',
    description: 'With AGM or Flooded the inverter uses its own charge voltages; bulk, floating and low DC cut-off voltages set here apply only with User-Defined or Lithium. Equalization can be enabled only with Flooded or User-Defined.',
    options: ['AGM', 'Flooded', 'User-Defined', 'Lithium without communication'],
    default: 'AGM',
    affects: ['MaxChargingVoltage', 'FloatingChargingVoltage', 'BatteryLowVoltageProtectionOffGrid', 'BatteryEqModeEnabled'],
  },
  {
    program: '10',
    title: 'Auto bypass',
    description: 'With "Auto", the loads are bypassed to utility whenever mains is normal, even with the power switch off. Not the same as overload bypass.',
    options: ['Manual', 'Auto'],
    default: 'Manual',
  },
  {
    program: '13',
    title: 'Back to battery voltage: battery fully charged',
    description: 'The panel default for the back-to-battery point is "battery fully charged" rather than a voltage. How the inverter reports it over the protocol is not documented.',
    default: 'Battery fully charged',
    affects: ['BatteryDischargeRecoveryMains'],
  },
  {
    program: '25',
    title: 'Modbus ID',
    description: 'The address the inverter answers to, 1-247. The app talks to ID 1; changing it on the panel disconnects the app.',
    default: '1',
  },
  {
    program: '32',
    title: 'Bulk charging time (C.V stage)',
    description: 'How long the bulk (constant-voltage) stage lasts: decided automatically, or 5-900 minutes in steps of 5. Settable only with battery type User-Defined.',
    default: 'Automatically',
  },
  {
    program: '39',
    title: 'Equalization activated immediately',
    description: 'Starts an equalization charge now (the LCD shows "Eq"), or cancels it until the next equalization interval. Available only while equalization is enabled.',
    options: ['Disable', 'Enable'],
    default: 'Disable',
    affects: ['BatteryEqModeEnabled'],
  },
  {
    program: '41',
    title: 'Automatic activation for lithium battery',
    description: 'On models that support it, with a lithium or User-Defined battery type: if no battery is detected, the inverter activates the lithium battery once at start-up. Takes effect after restarting the inverter.',
    options: ['Disable', 'Enable'],
    default: 'Disable',
  },
  {
    program: '42',
    title: 'Manual activation for lithium battery',
    description: 'On models that support it, with a lithium battery type: activates an undetected lithium battery once, when selected.',
    options: ['Disable', 'Activate'],
    default: 'Disable',
  },
  {
    program: '46',
    title: 'Maximum discharge current protection',
    description: 'In Single output mode only. With utility available, the inverter switches to utility and stops discharging once the battery discharge current exceeds the limit; without utility it warns and keeps discharging.',
    default: 'Off',
    affects: ['OutputMode'],
  },
];
