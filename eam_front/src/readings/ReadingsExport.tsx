import { useState } from 'react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Download } from 'lucide-react';
import axios from '../lib/apiClient';
import { daysRange, toDay, type Day } from './days';

/** The server's limit on one export. */
const MAX_DAYS = 31;

function rangeProblem(first: Day, last: Day): string | null {
  if (!first || !last) return 'Choose both days.';
  const days = differenceInCalendarDays(parseISO(last), parseISO(first)) + 1;
  if (days < 1) return 'Start on or before the end day.';
  if (days > MAX_DAYS) return `Export at most ${MAX_DAYS} days at a time.`;
  return null;
}

/** Saves a blob under `name` through a temporary download link. */
function save(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  URL.revokeObjectURL(href);
}

interface Props {
  profileId: number;
  today?: Day;
}

/** Downloads the readings of a range of whole days as CSV, times in the browser's time zone. */
export default function ReadingsExport({ profileId, today = toDay(new Date()) }: Props) {
  const [first, setFirst] = useState<Day>(today);
  const [last, setLast] = useState<Day>(today);
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const problem = rangeProblem(first, last);

  async function exportCsv() {
    setExporting(true);
    setFailed(false);
    try {
      const { data } = await axios.get<Blob>(`/api/inverter/${profileId}/readings/export`, {
        params: { ...daysRange(first, last), tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
        responseType: 'blob',
      });
      save(data, `readings-${first}-to-${last}.csv`);
    } catch {
      setFailed(true);
    } finally {
      setExporting(false);
    }
  }

  const inputClass =
    'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  const error = problem ?? (failed ? "Couldn't export the readings." : null);

  return (
    <section aria-labelledby="readings-export-title" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 id="readings-export-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Export
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
          From
          <input type="date" value={first} max={today} onChange={(e) => setFirst(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
          To
          <input type="date" value={last} max={today} onChange={(e) => setLast(e.target.value)} className={inputClass} />
        </label>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={problem !== null || exporting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
