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
  /** The inverter's BMS, when there is one: its readings can be exported too. */
  bmsId?: number | null;
}

/** Downloads the readings of a range of whole days as CSV, times in the browser's time zone. */
export default function ReadingsExport({ profileId, today = toDay(new Date()), bmsId = null }: Props) {
  const [first, setFirst] = useState<Day>(today);
  const [last, setLast] = useState<Day>(today);
  const [source, setSource] = useState<'inverter' | 'bms'>('inverter');
  const fromBms = source === 'bms' && bmsId !== null;
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const problem = rangeProblem(first, last);

  async function exportCsv() {
    setExporting(true);
    setFailed(false);
    try {
      const url = fromBms
        ? `/api/inverter/profiles/${profileId}/bms/${bmsId}/export`
        : `/api/inverter/${profileId}/readings/export`;
      const { data } = await axios.get<Blob>(url, {
        params: { ...daysRange(first, last), tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
        responseType: 'blob',
      });
      save(data, `${fromBms ? 'bms' : 'readings'}-${first}-to-${last}.csv`);
    } catch {
      setFailed(true);
    } finally {
      setExporting(false);
    }
  }

  const inputClass = 'h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink';
  const error = problem ?? (failed ? "Couldn't export the readings." : null);

  return (
    <section aria-label="Export" className="text-ink">
      <p className="mb-3 text-sm text-muted">Whole days as CSV, times in this browser’s time zone, at most {MAX_DAYS} days at a time.</p>
      <div className="flex flex-wrap items-end gap-3">
        {bmsId !== null && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Data
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as 'inverter' | 'bms')}
              className={inputClass}
            >
              <option value="inverter">Inverter</option>
              <option value="bms">Battery (BMS)</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">
          From
          <input type="date" value={first} max={today} onChange={(e) => setFirst(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          To
          <input type="date" value={last} max={today} onChange={(e) => setLast(e.target.value)} className={inputClass} />
        </label>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={problem !== null || exporting}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-semibold text-page transition hover:opacity-90 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
    </section>
  );
}
