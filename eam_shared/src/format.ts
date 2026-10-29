/** Units with a name per language (кВт, В, Гц…); %, °C and the like are the same everywhere. */
export type Unit = 'W' | 'kW' | 'kWh' | 'Wh' | 'V' | 'mV' | 'A' | 'Ah' | 'Hz' | 'VA' | 'h' | 'm' | 's' | 'rpm';

export interface Formatter {
  /** A number with exactly `decimals` decimals (default 0) in the locale's way: 1,234.5 or 1 234,5. */
  num(value: number, decimals?: number): string;
  /** The unit as written in this language. */
  unit(u: Unit): string;
  /** A number with its unit: "2.84 kW". */
  withUnit(value: number, u: Unit, decimals?: number): string;
  /** A measured value as is: no thousands separators, at most 3 decimals, the locale's decimal separator. */
  plain(value: number): string;
  /** plain() followed by a space and the unit. */
  plainUnit(value: number, u: Unit): string;
  /** Power: "--" for undefined or NaN; otherwise the magnitude (Math.abs), from 1000 W up as kW with 2 decimals ("2.84 kW"), below as whole watts ("620 W"). */
  power(watts: number | undefined): string;
}

/** A Formatter for `locale` (e.g. 'en-GB', 'uk-UA') with the language's unit names; a unit missing from `units` is written as is. */
export function formatter(locale: string, units: Partial<Record<Unit, string>>): Formatter {
  const num = (value: number, decimals = 0): string => {
    const fmt = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return fmt.format(value);
  };

  const unit = (u: Unit): string => {
    return units[u] ?? u;
  };

  const withUnit = (value: number, u: Unit, decimals?: number): string => {
    return `${num(value, decimals)} ${unit(u)}`;
  };

  const plain = (value: number): string => {
    const fmt = new Intl.NumberFormat(locale, {
      useGrouping: false,
      maximumFractionDigits: 3,
    });
    return fmt.format(value);
  };

  const plainUnit = (value: number, u: Unit): string => {
    return `${plain(value)} ${unit(u)}`;
  };

  const power = (watts: number | undefined): string => {
    if (watts === undefined || Number.isNaN(watts)) {
      return '--';
    }
    const magnitude = Math.abs(watts);
    if (magnitude >= 1000) {
      return `${num(magnitude / 1000, 2)} ${unit('kW')}`;
    }
    return `${num(Math.round(magnitude))} ${unit('W')}`;
  };

  return {
    num,
    unit,
    withUnit,
    plain,
    plainUnit,
    power,
  };
}
