import { useEffect, useRef, useState } from 'react';
import axios from '../lib/apiClient';
import { formatRegisterValue } from '../inverter/format';
import type { RegisterDefinition } from '../inverter/types';
import { dayLabel, dayRange, shiftDay, toDay, type Day } from './days';

interface Reading {
  id: number;
  timestamp: string;
  payload: Record<string, number>;
}

interface ReadingsLogProps {
  profileId: number;
  registers: RegisterDefinition[];
  today?: Day;
}

/** Every Reading of one local day, newest first, by register name and value, a page at a time. */
export default function ReadingsLog({
  profileId,
  registers,
  today = toDay(new Date()),
}: ReadingsLogProps) {
  const [day, setDay] = useState<Day>(today);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const token = ++requestIdRef.current;

    const loadFirstPage = async () => {
      setStatus('loading');
      setReadings([]);
      setHasMore(false);
      setLoadingMore(false);

      try {
        const { from, to } = dayRange(day);
        const response = await axios.get<Reading[]>(
          `/api/inverter/${profileId}/readings`,
          { params: { from, to, limit: 100 } },
        );

        if (token !== requestIdRef.current) {
          return;
        }

        setReadings(response.data);
        setHasMore(response.data.length === 100);
        setStatus('ready');
      } catch {
        if (token !== requestIdRef.current) {
          return;
        }

        setStatus('error');
      }
    };

    void loadFirstPage();

    return () => {
      requestIdRef.current += 1;
    };
  }, [profileId, day]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || status !== 'ready') {
      return;
    }

    const oldest = readings[readings.length - 1];
    if (!oldest) {
      return;
    }

    const token = requestIdRef.current;
    setLoadingMore(true);

    try {
      const { from, to } = dayRange(day);
      const response = await axios.get<Reading[]>(
        `/api/inverter/${profileId}/readings`,
        { params: { from, to, limit: 100, before: oldest.timestamp } },
      );

      if (token !== requestIdRef.current) {
        return;
      }

      setReadings((previous) => [...previous, ...response.data]);
      setHasMore(response.data.length === 100);
      setLoadingMore(false);
    } catch {
      if (token === requestIdRef.current) {
        setLoadingMore(false);
      }
    }
  };

  const buttonClass =
    'inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';
  const inputClass =
    'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  const cardClass =
    'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
  const mutedTextClass = 'text-sm text-gray-700 dark:text-gray-300';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => setDay(today)}>
          Today
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => setDay(shiftDay(today, -1))}
        >
          Yesterday
        </button>
        <button
          type="button"
          aria-label="Previous day"
          className={buttonClass}
          onClick={() => setDay(shiftDay(day, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next day"
          className={buttonClass}
          disabled={day >= today}
          onClick={() => setDay(shiftDay(day, 1))}
        >
          ›
        </button>
        <input
          type="date"
          aria-label="Day"
          className={inputClass}
          max={today}
          value={day}
          onChange={(event) => {
            const value = event.target.value;
            if (value) {
              setDay(value as Day);
            }
          }}
        />
      </div>

      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {dayLabel(day, today)}
      </h2>

      {status === 'error' ? (
        <p role="alert" className={mutedTextClass}>
          Couldn't load the readings.
        </p>
      ) : status === 'loading' ? (
        <p className={mutedTextClass}>Loading…</p>
      ) : readings.length === 0 ? (
        <p className={mutedTextClass}>No readings on this day.</p>
      ) : (
        <>
          <ol aria-label="Readings" className="space-y-4">
            {readings.map((reading) => (
              <li key={reading.id} className={cardClass}>
                <time className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {new Date(reading.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
                </time>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4 text-sm">
                  {registers.map((definition) => {
                    if (!(definition.name in reading.payload)) {
                      return null;
                    }

                    const value = reading.payload[definition.name];

                    return (
                      <div key={definition.name} className="flex flex-col">
                        <dt className="text-xs text-gray-500 dark:text-gray-400">
                          {definition.label}
                        </dt>
                        <dd className="text-gray-900 dark:text-gray-100">
                          {formatRegisterValue(definition, value)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            ))}
          </ol>

          {hasMore && (
            <button
              type="button"
              className={buttonClass}
              disabled={loadingMore || status !== 'ready'}
              onClick={() => void loadMore()}
            >
              Load more
            </button>
          )}
        </>
      )}
    </section>
  );
}
