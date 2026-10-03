/** How far a reference reading is from a captured value: "cloud reading 4m12s after this value". */
export function formatGap(gapMs: number): string {
  const side = gapMs >= 0 ? 'after' : 'before';
  const total = Math.round(Math.abs(gapMs) / 1000);
  let duration: string;

  if (total >= 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    duration = `${hours}h${minutes}m`;
  } else if (total >= 60) {
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    duration = `${minutes}m${seconds}s`;
  } else {
    duration = `${total}s`;
  }

  return `cloud reading ${duration} ${side} this value`;
}
