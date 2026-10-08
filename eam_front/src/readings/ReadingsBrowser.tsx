import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import axios from '../lib/apiClient';
import { formatRegisterValue } from '../inverter/format';
import type { RegisterDefinition } from '../inverter/types';
import { dayLabel, dayRange, shiftDay, toDay, type Day } from './days';
import type { BmsReading } from '../bms/types';
import { Segmented } from '../ui';
import BmsReadingRows from './BmsReadingRows';

interface Reading {
  id: number;
  timestamp: string;
  /** Inverter readings. */
  payload?: Record<string, number>;
  /** BMS readings. */
  reading?: BmsReading;
}
type Source = 'inverter' | 'bms';

const PAGE = 100;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
const iconButton = 'grid h-9 w-9 place-items-center rounded-lg border border-line-strong text-ink hover:bg-surface-2 disabled:opacity-40';

/** One day's stored readings: their times on the left, the picked reading's values on the right. */
export default function ReadingsBrowser({
  profileId,
  registers,
  today = toDay(new Date()),
  bmsId = null,
}: {
  profileId: number;
  registers: RegisterDefinition[];
  today?: Day;
  /** The inverter's BMS, when there is one: its readings can be shown instead. */
  bmsId?: number | null;
}) {
  const [source, setSource] = useState<Source>('inverter');
  const url =
    source === 'bms' && bmsId !== null
      ? `/api/inverter/profiles/${profileId}/bms/${bmsId}/readings`
      : `/api/inverter/${profileId}/readings`;
  const [day, setDay] = useState<Day>(today);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const token = ++requestIdRef.current;
    void (async () => {
      setStatus('loading');
      setReadings([]);
      setHasMore(false);
      setSelectedId(null);
      try {
        const { data } = await axios.get<Reading[]>(url, {
          params: { ...dayRange(day), limit: PAGE },
        });
        if (token !== requestIdRef.current) return;
        setReadings(data);
        setHasMore(data.length === PAGE);
        setSelectedId(data[0]?.id ?? null);
        setStatus('ready');
      } catch {
        if (token === requestIdRef.current) setStatus('error');
      }
    })();
    return () => {
      requestIdRef.current += 1;
    };
  }, [url, day]);

  async function loadMore() {
    const oldest = readings[readings.length - 1];
    if (!hasMore || loadingMore || !oldest) return;
    const token = requestIdRef.current;
    setLoadingMore(true);
    try {
      const { data } = await axios.get<Reading[]>(url, {
        params: { ...dayRange(day), limit: PAGE, before: oldest.timestamp },
      });
      if (token !== requestIdRef.current) return;
      setReadings((previous) => [...previous, ...data]);
      setHasMore(data.length === PAGE);
    } finally {
      if (token === requestIdRef.current) setLoadingMore(false);
    }
  }

  const toggleField = (name: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const selected = readings.find((r) => r.id === selectedId) ?? null;
  const shownFields = registers.filter((d) => !hidden.has(d.name));
  const onOptionKey = (event: KeyboardEvent, id: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedId(id);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Previous day" className={iconButton} onClick={() => setDay(shiftDay(day, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input
          type="date"
          aria-label="Day"
          max={today}
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value as Day)}
          className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink"
        />
        <button type="button" aria-label="Next day" className={iconButton} disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">{dayLabel(day, today)}</span>
        {bmsId !== null && (
          <Segmented
            ariaLabel="Readings of"
            size="sm"
            value={source}
            onChange={setSource}
            options={[
              { value: 'inverter', label: 'Inverter' },
              { value: 'bms', label: 'Battery (BMS)' },
            ]}
          />
        )}
        {source === 'inverter' && (
          <div className="relative ml-auto">
            <button
              type="button"
              aria-expanded={fieldsOpen}
              onClick={() => setFieldsOpen((o) => !o)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-sm hover:bg-surface-2"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {`Fields · ${shownFields.length} of ${registers.length}`}
            </button>
            {fieldsOpen && (
              <div className="absolute top-11 right-0 z-30 max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-xl">
                {registers.map((d) => (
                  <label key={d.name} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                    <input type="checkbox" checked={!hidden.has(d.name)} onChange={() => toggleField(d.name)} />
                    {d.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {status === 'loading' && <p className="py-10 text-center text-sm text-muted">Loading…</p>}
      {status === 'error' && (
        <p role="alert" className="py-10 text-center text-sm text-muted">
          Couldn&apos;t load the readings.
        </p>
      )}
      {status === 'ready' && readings.length === 0 && <p className="py-10 text-center text-sm text-muted">No readings on this day.</p>}
      {status === 'ready' && readings.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
          <div className="flex max-h-[520px] flex-col overflow-hidden rounded-lg border border-line">
            <p className="border-b border-line bg-surface-2 px-3 py-2 text-xs text-muted">{readings.length} readings</p>
            <ul role="listbox" aria-label="Readings" className="flex-1 overflow-y-auto">
              {readings.map((r) => {
                const isSelected = r.id === selectedId;
                return (
                  <li
                    key={r.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => setSelectedId(r.id)}
                    onKeyDown={(e) => onOptionKey(e, r.id)}
                    className={
                      'cursor-pointer px-3 py-2 font-mono text-[13px]' +
                      (isSelected ? ' bg-sel font-semibold text-on-sel' : ' hover:bg-surface-2')
                    }
                  >
                    {time(r.timestamp)}
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="m-2 h-8 rounded-lg border border-line-strong text-[13px] hover:bg-surface-2 disabled:opacity-50"
              >
                Load more
              </button>
            )}
          </div>
          {selected && (
            <table
              aria-label={`Reading at ${time(selected.timestamp)}`}
              className="w-full overflow-hidden rounded-lg border border-line text-sm"
            >
              <caption className="border-b border-line bg-surface-2 px-3 py-2 text-left">
                <span className="font-mono font-semibold">{time(selected.timestamp)}</span>{' '}
                <span className="text-xs text-muted">
                  {source === 'bms' ? 'Battery reading' : 'Inverter reading'} · {dayLabel(day, today)}
                </span>
              </caption>
              <tbody>
                {selected.reading && <BmsReadingRows reading={selected.reading} />}
                {selected.payload &&
                  shownFields
                    .filter((d) => d.name in selected.payload!)
                    .map((d) => (
                      <tr key={d.name} className="border-t border-line">
                        <th scope="row" className="px-3 py-2 text-left font-normal text-muted">
                          {d.label}
                        </th>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {formatRegisterValue(d, selected.payload![d.name])}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
