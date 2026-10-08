import type { BmsReading } from '../bms/types';

/** Renders a set of table rows for a single BMS reading. */
export default function BmsReadingRows({ reading }: { reading: BmsReading }) {
  const rows: [string, string][] = [];

  if (reading.stateOfChargePct !== null) {
    rows.push(['State of charge', `${Math.round(reading.stateOfChargePct)}%`]);
  }
  if (reading.packVoltageV !== null) {
    rows.push(['Pack voltage', `${reading.packVoltageV.toFixed(2)} V`]);
  }
  if (reading.currentA !== null) {
    rows.push(['Current', `${reading.currentA > 0 ? '+' : ''}${reading.currentA.toFixed(1)} A`]);
  }
  if (reading.powerW !== null) {
    rows.push(['Power', `${Math.round(reading.powerW).toLocaleString('en-US')} W`]);
  }
  if (reading.remainingCapacityAh !== null && reading.nominalCapacityAh !== null) {
    rows.push(['Remaining', `${reading.remainingCapacityAh} of ${reading.nominalCapacityAh} Ah`]);
  }
  if (reading.cycleCount !== null) {
    rows.push(['Cycles', String(reading.cycleCount)]);
  }
  if (reading.cellDeltaV !== null) {
    rows.push(['Cell spread', `${Math.round(reading.cellDeltaV * 1000)} mV`]);
  }
  if (reading.cellVoltagesV) {
    reading.cellVoltagesV.forEach((v, i) => {
      rows.push([`Cell ${i + 1}`, `${v.toFixed(3)} V`]);
    });
  }
  if (reading.temperaturesC) {
    reading.temperaturesC.forEach((t) => {
      rows.push([t.name, `${t.celsius.toFixed(1)} °C`]);
    });
  }
  if (reading.balancing !== null) {
    rows.push(['Balancing', reading.balancing ? 'On' : 'Off']);
  }
  if (reading.chargeMosfetOn !== null) {
    rows.push(['Charge MOSFET', reading.chargeMosfetOn ? 'On' : 'Off']);
  }
  if (reading.dischargeMosfetOn !== null) {
    rows.push(['Discharge MOSFET', reading.dischargeMosfetOn ? 'On' : 'Off']);
  }
  if (reading.alarms) {
    rows.push(['Alarms', reading.alarms.length ? reading.alarms.join(', ') : 'None']);
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
