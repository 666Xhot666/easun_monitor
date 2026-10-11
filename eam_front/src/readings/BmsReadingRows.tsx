import type { BmsReading } from '../bms/types';
import { useTranslation } from 'react-i18next';
import { num, unit, withUnit } from '../i18n/format';

/** Renders a set of table rows for a single BMS reading. */
export default function BmsReadingRows({ reading }: { reading: BmsReading }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [];

  if (reading.stateOfChargePct !== null) {
    rows.push([t('readings.bmsRows.soc'), `${Math.round(reading.stateOfChargePct)}%`]);
  }
  if (reading.packVoltageV !== null) {
    rows.push([t('readings.bmsRows.packVoltage'), withUnit(reading.packVoltageV, 'V', 2)]);
  }
  if (reading.currentA !== null) {
    rows.push([t('readings.bmsRows.current'), `${reading.currentA > 0 ? '+' : ''}${withUnit(reading.currentA, 'A', 1)}`]);
  }
  if (reading.powerW !== null) {
    rows.push([t('readings.bmsRows.power'), withUnit(Math.round(reading.powerW), 'W')]);
  }
  if (reading.remainingCapacityAh !== null && reading.nominalCapacityAh !== null) {
    rows.push([
      t('readings.bmsRows.remaining'),
      t('readings.bmsRows.remainingValue', { remaining: reading.remainingCapacityAh, nominal: `${reading.nominalCapacityAh} ${unit('Ah')}` }),
    ]);
  }
  if (reading.cycleCount !== null) {
    rows.push([t('readings.bmsRows.cycles'), String(reading.cycleCount)]);
  }
  if (reading.cellDeltaV !== null) {
    rows.push([t('readings.bmsRows.cellSpread'), withUnit(Math.round(reading.cellDeltaV * 1000), 'mV')]);
  }
  if (reading.cellVoltagesV) {
    reading.cellVoltagesV.forEach((v, i) => {
      rows.push([t('readings.bmsRows.cell', { n: i + 1 }), withUnit(v, 'V', 3)]);
    });
  }
  if (reading.temperaturesC) {
    reading.temperaturesC.forEach((temp) => {
      rows.push([temp.name, `${num(temp.celsius, 1)} °C`]);
    });
  }
  if (reading.balancing !== null) {
    rows.push([t('readings.bmsRows.balancing'), t(reading.balancing ? 'readings.bmsRows.on' : 'readings.bmsRows.off')]);
  }
  if (reading.chargeMosfetOn !== null) {
    rows.push([t('readings.bmsRows.chargeMosfet'), t(reading.chargeMosfetOn ? 'readings.bmsRows.on' : 'readings.bmsRows.off')]);
  }
  if (reading.dischargeMosfetOn !== null) {
    rows.push([t('readings.bmsRows.dischargeMosfet'), t(reading.dischargeMosfetOn ? 'readings.bmsRows.on' : 'readings.bmsRows.off')]);
  }
  if (reading.alarms) {
    rows.push([t('readings.bmsRows.alarms'), reading.alarms.length ? reading.alarms.join(', ') : t('readings.bmsRows.none')]);
  }

  return (
    <>
      {rows.map(([label, value]) => (
        <tr key={label} className="border-t border-line">
          <th scope="row" className="px-3 py-2 text-left font-normal text-muted">{label}</th>
          <td className="px-3 py-2 text-right font-semibold tabular-nums">{value}</td>
        </tr>
      ))}
    </>
  );
}
