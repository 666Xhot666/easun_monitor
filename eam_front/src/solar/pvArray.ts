/** A panel model from its datasheet (standard test conditions), as served by /api/panel-types. */
export interface PanelType {
  id: number;
  name: string;
  maxPowerW: number;
  vmpV: number;
  impA: number;
  vocV: number;
  iscA: number;
}

/** `inSeries` panels per string, `strings` strings in parallel. */
export interface ArrayWiring {
  inSeries: number;
  strings: number;
}

/** The whole array's ratings at standard test conditions. */
export interface PvArray {
  panels: number;
  powerW: number;
  vmpV: number;
  vocV: number;
  impA: number;
  iscA: number;
}

/** The inverter's PV input limits; unset ones are not checked. */
export interface PvLimits {
  maxVocV?: number | null;
  mpptMinV?: number | null;
  mpptMaxV?: number | null;
  maxPowerW?: number | null;
  maxCurrentA?: number | null;
}

export interface ArrayWarning {
  /** danger: can damage the inverter. warning: works badly or trips. info: by design, worth knowing. */
  level: 'danger' | 'warning' | 'info';
  message: string;
}

/** Open-circuit voltage rises in the cold; this much headroom below the maximum is kept. */
export const COLD_VOC_MARGIN = 0.15;

const round = (value: number) => Math.round(value * 100) / 100;

/** Voltages add along a string; currents add across parallel strings. */
export function computeArray(panel: PanelType, wiring: ArrayWiring): PvArray {
  return {
    panels: wiring.inSeries * wiring.strings,
    powerW: round(panel.maxPowerW * wiring.inSeries * wiring.strings),
    vmpV: round(panel.vmpV * wiring.inSeries),
    vocV: round(panel.vocV * wiring.inSeries),
    impA: round(panel.impA * wiring.strings),
    iscA: round(panel.iscA * wiring.strings),
  };
}

/** What the array means for the inverter, checked against the limits that are set. */
export function checkArray(array: PvArray, limits: PvLimits): ArrayWarning[] {
  const warnings: ArrayWarning[] = [];
  const { maxVocV, mpptMinV, mpptMaxV, maxPowerW, maxCurrentA } = limits;

  if (maxVocV != null) {
    if (array.vocV > maxVocV) {
      warnings.push({
        level: 'danger',
        message: `Open-circuit voltage ${array.vocV} V is above the inverter maximum of ${maxVocV} V and can damage it.`,
      });
    } else if (array.vocV > maxVocV * (1 - COLD_VOC_MARGIN)) {
      warnings.push({
        level: 'warning',
        message: `Open-circuit voltage ${array.vocV} V is within 15% of the ${maxVocV} V maximum; it rises on cold mornings.`,
      });
    }
  }
  if (mpptMinV != null && array.vmpV < mpptMinV) {
    warnings.push({
      level: 'warning',
      message: `Working voltage ${array.vmpV} V is below the MPPT range (from ${mpptMinV} V): the inverter cannot track the array well.`,
    });
  }
  if (mpptMaxV != null && array.vmpV > mpptMaxV) {
    warnings.push({
      level: 'warning',
      message: `Working voltage ${array.vmpV} V is above the MPPT range (up to ${mpptMaxV} V).`,
    });
  }
  if (maxPowerW != null && array.powerW > maxPowerW) {
    warnings.push({
      level: 'info',
      message: `Array power ${array.powerW} W is above the ${maxPowerW} W PV input rating; the inverter caps what it takes.`,
    });
  }
  if (maxCurrentA != null && array.iscA > maxCurrentA) {
    warnings.push({
      level: 'warning',
      message: `Short-circuit current ${array.iscA} A is above the ${maxCurrentA} A PV input limit.`,
    });
  }
  return warnings;
}

/** PV power as a whole-number percentage of the array's rated power. */
export function utilization(pvW: number | undefined, ratedW: number | undefined): number | undefined {
  if (pvW === undefined || ratedW === undefined || ratedW <= 0) return undefined;
  return Math.round((Math.max(0, pvW) / ratedW) * 100);
}
