import { Link, useParams } from 'react-router-dom';
import { useRegisters } from '../inverter/useRegisters';
import ReadingsExport from '../readings/ReadingsExport';
import ReadingsLog from '../readings/ReadingsLog';

/** Every Reading of a day, by name and value, plus CSV export of a range of days. */
export default function ReadingsLogPage() {
  const { profileId: profileIdParam } = useParams<{ profileId: string }>();
  const profileId = Number(profileIdParam);
  const registers = useRegisters();
  const logged = registers?.filter((d) => d.group === 'telemetry' || d.group === 'status');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-6xl">
          <Link to={`/dashboard/${profileId}`} className="text-xs text-gray-500 hover:underline dark:text-gray-400">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Logs</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <ReadingsExport profileId={profileId} />
        {logged ? (
          <ReadingsLog profileId={profileId} registers={logged} />
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        )}
      </main>
    </div>
  );
}
