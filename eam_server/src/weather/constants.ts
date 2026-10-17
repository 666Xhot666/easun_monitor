// How the expected PV is worked out from the weather on the panels.

/** Share of the rated power reaching the inverter: wiring, dirt, mismatch, MPPT. */
export const PERFORMANCE_RATIO = 0.8;
/** Irradiance and cell temperature the panels' rating is given at. */
export const STC_IRRADIANCE_W_M2 = 1000;
export const STC_CELL_TEMP_C = 25;
/** Cells run warmer than the air: about 25 °C more at 800 W/m². */
export const CELL_HEATING_C_PER_W_M2 = 25 / 800;
/** Crystalline panels lose about 0.4 % of their power per °C above 25 °C. */
export const POWER_TEMP_COEFF_PER_C = -0.004;
