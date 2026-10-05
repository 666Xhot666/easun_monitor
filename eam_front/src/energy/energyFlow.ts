/** Power as shown on a flow line: "278W", "1.2kW" above 1000 W, "--" when
 * unknown. Always the magnitude; the line's dots show the direction. */
export function formatPower(watts: number | undefined): string {
  if (typeof watts !== 'number' || Number.isNaN(watts)) return '--';
  const magnitude = Math.abs(watts);
  if (magnitude > 1000) return `${(magnitude / 1000).toFixed(1)}kW`;
  return `${Math.round(magnitude)}W`;
}
