/** Bar scale for a LiFePO4 cell: empty to full. */
export const CELL_MIN_V = 2.5;
export const CELL_MAX_V = 3.65;
export const IDLE_A = 0.5;
/** The inverter setting that cuts off discharging at a battery voltage (SMG-II register name). */
export const INVERTER_CUTOFF_SETTING = 'BatteryLowVoltageProtectionOffGrid';
/** Discharge currents the wiring card shows the inverter's reading at. */
export const WIRING_CURRENTS_A = [25, 50, 75, 100];
/** Days back the wiring card fits over (the server's default). */
export const DEFAULT_WIRING_DAYS = 30;
