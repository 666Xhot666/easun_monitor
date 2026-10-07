import { useParams } from 'react-router-dom';
import { PageHeader } from '../ui';
import { useRegisters } from '../inverter/useRegisters';
import { useBmsDevices } from '../bms/useBmsDevices';
import ReadingsExport from '../readings/ReadingsExport';
import ReadingsLog from '../readings/ReadingsLog';

/** Every Reading of a day, by name and value, plus CSV export of a range of days. */
export default function ReadingsLogPage() {
  const { profileId: profileIdParam } = useParams<{ profileId: string }>();
  const profileId = Number(profileIdParam);
  const registers = useRegisters();
  const { devices: bmsDevices } = useBmsDevices(profileId);
  const logged = registers?.filter((d) => d.group === 'telemetry' || d.group === 'status');

  return (
    <>
      <PageHeader title="History" subtitle="Inverter and battery data over time" />
      <div className="space-y-6">
        <ReadingsExport profileId={profileId} bmsId={bmsDevices?.[0]?.id ?? null} />
        {logged ? (
          <ReadingsLog profileId={profileId} registers={logged} />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        )}
      </div>
    </>
  );
}
