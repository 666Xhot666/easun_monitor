/** What the battery's BMS specification says (manual, "Setting for lithium battery"). */
export interface BmsLimits {
  maxChargingVoltage: number;
  maxChargingCurrent: number;
  dischargeProtectionVoltage: number;
}

// Round to 0.1 V in a given direction, ignoring binary noise
// (29.2 - 0.5 = 28.699999999999996 must floor to 28.7).
const floorTenth = (value: number) => Math.floor(value * 10 + 1e-6) / 10;
const ceilTenth = (value: number) => Math.ceil(value * 10 - 1e-6) / 10;

/**
 * The manual's settings for a lithium battery without BMS communication,
 * rounded to what the inverter accepts and always on the safe side of each
 * limit:
 *
 * - bulk (C.V) voltage = BMS max charging voltage - 0.5 V, float = bulk
 * - low DC cut-off ≥ BMS discharge protection voltage + 2 V
 * - back to utility ≥ cut-off + 1 V (or the inverter warns of a low battery)
 * - max charging current below the BMS max charging current
 */
export function proposeLithiumSettings(bms: BmsLimits): Record<string, number> {
  const bulk = floorTenth(bms.maxChargingVoltage - 0.5);
  const cutOff = ceilTenth(bms.dischargeProtectionVoltage + 2);
  return {
    MaxChargingVoltage: bulk,
    FloatingChargingVoltage: bulk,
    BatteryLowVoltageProtectionOffGrid: cutOff,
    BatteryLowVoltageProtectionMains: ceilTenth(cutOff + 1),
    MaxChargingCurrent: Math.ceil(bms.maxChargingCurrent) - 1,
  };
}
