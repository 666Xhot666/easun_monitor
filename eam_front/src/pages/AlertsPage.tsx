import { useLiveData } from '../shell/LiveData';
import { Badge, Card, Dot, PageHeader } from '../ui';

/** Faults and warnings the inverter reports right now. */
export default function AlertsPage() {
  const { reading } = useLiveData();
  const faults = reading?.alerts?.faults ?? [];
  const warnings = reading?.alerts?.warnings ?? [];
  const active = [
    ...faults.map((text) => ({ text, kind: 'Fault' as const })),
    ...warnings.map((text) => ({ text, kind: 'Warning' as const })),
  ];

  return (
    <>
      <PageHeader title="Alerts" subtitle="Faults and warnings the inverter reports" />
      <Card as="div" className="p-0">
        <p className="border-b border-line px-5 py-3 text-xs font-semibold tracking-wide text-muted uppercase">Active now</p>
        {active.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No active faults or warnings.</p>
        ) : (
          <ul aria-label="Active alerts">
            {active.map(({ text, kind }) => (
              <li key={`${kind}-${text}`} className="flex items-center gap-3 border-t border-line px-5 py-3.5 first:border-t-0">
                <Dot tone={kind === 'Fault' ? 'crit' : 'warn'} />
                <span className="flex-1 text-[15px] font-medium">{text}</span>
                <Badge tone={kind === 'Fault' ? 'crit' : 'warn'}>{kind}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
