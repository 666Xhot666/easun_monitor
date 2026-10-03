import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useRegisters } from '../inverter/useRegisters';
import { formatRegisterValue } from '../inverter/format';
import type { RegisterDefinition } from '../inverter/types';
import NameSuggestions, { type NameSuggestion } from './NameSuggestions';

/** A reference reading this far from every value in a capture proves little. */
const FAR_FROM_CAPTURE_MS = 30 * 60_000;

interface PortStatus {
  path: string;
  baudRate: number;
  state: 'open' | 'reconnecting' | 'closed';
  error: string | null;
  reconnects: number;
}

interface RequestFrame {
  unit: number;
  func: number;
  address: number;
  quantity: number;
  hex: string;
}

interface ResponseFrame {
  unit: number;
  func: number;
  byteCount: number;
  words: number[];
  hex: string;
}

type CaptureRecord =
  | { seq: number; kind: 'pair'; request: RequestFrame; requestAt: number; response: ResponseFrame; responseAt: number }
  | { seq: number; kind: 'unanswered'; request: RequestFrame; requestAt: number }
  | { seq: number; kind: 'orphan'; response: ResponseFrame; responseAt: number }
  | { seq: number; kind: 'port'; at: number; port: 'rx' | 'tx'; state: string; message?: string };

interface CaptureState {
  running: boolean;
  captureId: string | null;
  ports: { rx: PortStatus | null; tx: PortStatus | null };
  skippedWrites: number;
  defaults: { rxPath: string | null; txPath: string | null; rxBaud: number; txBaud: number };
  records: CaptureRecord[];
}

interface CaptureMeta {
  id: string;
  startedAt: string;
  rxPath: string;
  txPath: string;
}

interface Summary {
  groundTruth?: { id: string; capturedAt: string; source?: string };
  suggestions?: NameSuggestion[];
  meta: CaptureMeta;
  counts: {
    pairs: number;
    plausible: number;
    implausible: number;
    unknown: number;
    unanswered: number;
    orphan: number;
    reconnects: number;
  };
  addresses: {
    address: number;
    name: string | null;
    latestValue: number;
    category: 'plausible' | 'implausible' | 'unknown';
    reason?: string;
    seen: number;
    lastSeenAt: number;
  }[];
  unanswered: { address: number; quantity: number; count: number }[];
}

type StatusState = Omit<CaptureState, 'records'>;
type Tab = 'live' | 'summary';

interface ErrorWithResponse {
  response?: { status?: number };
}

function getResponseStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const maybe = error as ErrorWithResponse;
  return maybe.response?.status ?? null;
}

function toStatus(data: CaptureState): StatusState {
  return {
    running: data.running,
    captureId: data.captureId,
    ports: data.ports,
    skippedWrites: data.skippedWrites,
    defaults: data.defaults,
  };
}

function formatPortLine(label: 'RX' | 'TX', port: PortStatus, skippedWrites: number): string {
  let line = `${label}: ${port.state}`;
  if (port.error !== null) {
    line += ` (${port.error})`;
  }
  if (port.reconnects > 0) {
    line += `, ${port.reconnects} reconnects`;
  }
  if (skippedWrites > 0) {
    line += `, ${skippedWrites} writes skipped`;
  }
  return line;
}

function tabClass(selected: boolean): string {
  return `rounded-md px-3 py-1 text-sm ${
    selected
      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
  }`;
}

/**
 * Dev-only two-tap serial capture panel; the server answers only in development with DEV_SERIAL_SNIFF=true.
 */
export default function DevSerialSniff({ pollMs = 1000 }: { pollMs?: number }) {
  const [status, setStatus] = useState<StatusState | null>(null);
  const [records, setRecords] = useState<CaptureRecord[]>([]);
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [rxPath, setRxPath] = useState('');
  const [txPath, setTxPath] = useState('');
  const [rxBaud, setRxBaud] = useState('');
  const [txBaud, setTxBaud] = useState('');

  const [activeTab, setActiveTab] = useState<Tab>('live');
  const [captures, setCaptures] = useState<CaptureMeta[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const [batteryVoltage, setBatteryVoltage] = useState('');
  const [groundTruths, setGroundTruths] = useState<{ id: string; capturedAt: string; source?: string }[]>([]);
  const [selectedGroundTruth, setSelectedGroundTruth] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const lastSeqRef = useRef(0);
  const editedRef = useRef(false);
  const summaryLoadedRef = useRef(false);
  const mountedRef = useRef(true);

  const registers = useRegisters();
  const registerByAddress = new Map<number, RegisterDefinition>();
  if (registers) {
    for (const definition of registers) {
      registerByAddress.set(definition.address, definition);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyStatus = (data: CaptureState) => {
    const nextStatus = toStatus(data);
    setStatus(nextStatus);
    if (!editedRef.current) {
      setRxPath(nextStatus.defaults.rxPath ?? '');
      setTxPath(nextStatus.defaults.txPath ?? '');
      setRxBaud(String(nextStatus.defaults.rxBaud));
      setTxBaud(String(nextStatus.defaults.txBaud));
    }
  };

  useEffect(() => {
    if (off) {
      return;
    }

    let active = true;

    const tick = async () => {
      if (!active) {
        return;
      }

      try {
        const response = await axios.get<CaptureState>(`/api/dev/serial?since=${lastSeqRef.current}`);
        if (!active) {
          return;
        }

        const data = response.data;
        applyStatus(data);
        setError(null);

        const fresh = data.records
          .filter((record) => record.seq > lastSeqRef.current)
          .sort((a, b) => a.seq - b.seq);

        if (fresh.length > 0) {
          setRecords((previous) => {
            const merged = [...previous, ...fresh];
            return merged.length > 2000 ? merged.slice(merged.length - 2000) : merged;
          });
          lastSeqRef.current = fresh[fresh.length - 1].seq;
        }
      } catch (err: unknown) {
        if (!active) {
          return;
        }
        if (getResponseStatus(err) === 404) {
          setOff(true);
          setError(null);
        } else {
          setError(extractErrorMessage(err, 'Couldn\'t reach the serial capture.'));
        }
      }
    };

    tick();
    const interval = window.setInterval(tick, pollMs);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [off, pollMs]);

  useEffect(() => {
    if (off || activeTab !== 'summary' || summaryLoadedRef.current) {
      return;
    }

    summaryLoadedRef.current = true;
    let active = true;

    axios
      .get<{ id: string; capturedAt: string; source?: string }[]>('/api/dev/serial/ground-truth')
      .then((response) => {
        if (active && mountedRef.current) {
          setGroundTruths(response.data);
        }
      })
      .catch(() => {});

    axios
      .get<CaptureMeta[]>('/api/dev/serial/captures')
      .then((response) => {
        if (active && mountedRef.current) {
          setCaptures(response.data);
        }
      })
      .catch((err: unknown) => {
        if (active && mountedRef.current) {
          setSummaryError(extractErrorMessage(err, 'Couldn\'t load captures.'));
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, off]);

  const handleStart = async () => {
    if (!rxPath.trim() || !txPath.trim() || actionBusy) {
      return;
    }

    setActionBusy(true);
    setError(null);

    try {
      const response = await axios.post<CaptureState>('/api/dev/serial/start', {
        rxPath: rxPath.trim(),
        txPath: txPath.trim(),
        rxBaud: Number(rxBaud),
        txBaud: Number(txBaud),
      });
      if (!mountedRef.current) {
        return;
      }
      applyStatus(response.data);
      setError(null);
    } catch (err: unknown) {
      if (!mountedRef.current) {
        return;
      }
      setError(extractErrorMessage(err, 'Couldn\'t start capture.'));
    } finally {
      if (mountedRef.current) {
        setActionBusy(false);
      }
    }
  };

  const handleStop = async () => {
    if (actionBusy) {
      return;
    }

    setActionBusy(true);
    setError(null);

    try {
      const response = await axios.post<CaptureState>('/api/dev/serial/stop');
      if (!mountedRef.current) {
        return;
      }
      applyStatus(response.data);
      setError(null);
    } catch (err: unknown) {
      if (!mountedRef.current) {
        return;
      }
      setError(extractErrorMessage(err, 'Couldn\'t stop capture.'));
    } finally {
      if (mountedRef.current) {
        setActionBusy(false);
      }
    }
  };

  const suggestionFor = (address: number) => summary?.suggestions?.find((s) => s.address === address);

  const handleSummarise = async () => {
    if (!selectedCaptureId || summaryLoading) {
      return;
    }

    setSummaryLoading(true);
    setSummaryError(null);

    try {
      const params = new URLSearchParams();
      if (batteryVoltage.trim() !== '') params.set('batteryVoltage', batteryVoltage.trim());
      if (selectedGroundTruth) params.set('groundTruth', selectedGroundTruth);
      const query = params.size ? `?${params.toString()}` : '';
      const response = await axios.get<Summary>(`/api/dev/serial/captures/${selectedCaptureId}/summary${query}`);
      if (!mountedRef.current) {
        return;
      }
      setSummary(response.data);
    } catch (err: unknown) {
      if (!mountedRef.current) {
        return;
      }
      setSummaryError(extractErrorMessage(err, 'Couldn\'t summarise capture.'));
    } finally {
      if (mountedRef.current) {
        setSummaryLoading(false);
      }
    }
  };

  const formatPairValues = (request: RequestFrame, response: ResponseFrame): string => {
    return response.words
      .map((word, index) => {
        const address = request.address + index;
        const definition = registerByAddress.get(address);
        if (definition && definition.type !== 'uint32') {
          const raw = definition.type === 'int16' && word > 0x7fff ? word - 0x10000 : word;
          return `${definition.name} = ${formatRegisterValue(definition, raw * (definition.scale ?? 1))}`;
        }
        return `${address}: ${word}`;
      })
      .join(', ');
  };

  if (off) {
    return (
      <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-gray-700 dark:text-gray-300">The serial capture is off. Run the server outside production with <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">DEV_SERIAL_SNIFF=true</code> on the machine wired to the logger (optionally <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">SERIAL_RX_PORT</code>, <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">SERIAL_TX_PORT</code> and their <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">_BAUD</code> settings).</p>
        </div>
      </main>
    );
  }

  const reversedRecords = [...records].reverse();

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <Link to="/dashboard" className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">← Dashboard</Link>
          <h1 className="text-2xl font-semibold">Serial capture (dev)</h1>
        </header>

        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Both taps only listen: nothing is written to either port. Values are named from the register map; unknown addresses are shown raw for you to review.</p>

        {error && (
          <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>
        )}

        <div role="tablist" className="mb-4 flex gap-2">
          <button type="button" role="tab" aria-selected={activeTab === 'live'} aria-controls="serial-live-panel" id="serial-live-tab" onClick={() => setActiveTab('live')} className={tabClass(activeTab === 'live')}>Live</button>
          <button type="button" role="tab" aria-selected={activeTab === 'summary'} aria-controls="serial-summary-panel" id="serial-summary-tab" onClick={() => setActiveTab('summary')} className={tabClass(activeTab === 'summary')}>Summary</button>
        </div>

        {activeTab === 'live' ? (
          <section role="tabpanel" id="serial-live-panel" aria-labelledby="serial-live-tab" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Response port (RX)
                <input
                  type="text"
                  value={rxPath}
                  onChange={(event) => {
                    editedRef.current = true;
                    setRxPath(event.target.value);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">
                RX baud
                <input
                  type="number"
                  value={rxBaud}
                  onChange={(event) => {
                    editedRef.current = true;
                    setRxBaud(event.target.value);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Request port (TX)
                <input
                  type="text"
                  value={txPath}
                  onChange={(event) => {
                    editedRef.current = true;
                    setTxPath(event.target.value);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">
                TX baud
                <input
                  type="number"
                  value={txBaud}
                  onChange={(event) => {
                    editedRef.current = true;
                    setTxBaud(event.target.value);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!rxPath.trim() || !txPath.trim() || actionBusy || status?.running}
                onClick={handleStart}
                className="rounded-md bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
              >
                Start capture
              </button>
              {status?.running && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={handleStop}
                  className="rounded-md bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400"
                >
                  Stop capture
                </button>
              )}
            </div>

            {status && (status.ports.rx !== null || status.ports.tx !== null) && (
              <div role="status" className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {status.ports.rx && <p>{formatPortLine('RX', status.ports.rx, status.skippedWrites)}</p>}
                {status.ports.tx && <p>{formatPortLine('TX', status.ports.tx, status.skippedWrites)}</p>}
              </div>
            )}

            <div className="overflow-x-auto">
              {reversedRecords.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">No records yet.</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-gray-100 dark:bg-gray-900">
                    <tr>
                      <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">#</th>
                      <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Kind</th>
                      <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Request</th>
                      <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Values</th>
                      <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Raw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reversedRecords.map((record) => {
                      const kind = record.kind === 'pair'
                        ? 'pair'
                        : record.kind === 'unanswered'
                          ? 'unanswered'
                          : record.kind === 'orphan'
                            ? 'orphan'
                            : `${record.port.toUpperCase()} ${record.state}`;

                      const requestCell = record.kind === 'pair' || record.kind === 'unanswered'
                        ? `${record.request.address} ×${record.request.quantity}`
                        : record.kind === 'orphan'
                          ? '—'
                          : '';

                      const valuesCell = record.kind === 'pair'
                        ? formatPairValues(record.request, record.response)
                        : record.kind === 'unanswered'
                          ? 'no response'
                          : record.kind === 'orphan'
                            ? record.response.words.join(', ')
                            : record.message ?? '';

                      const rawCell = record.kind === 'pair'
                        ? record.response.hex
                        : record.kind === 'unanswered'
                          ? record.request.hex
                          : record.kind === 'orphan'
                            ? record.response.hex
                            : '';

                      return (
                        <tr key={record.seq} className="border-b border-gray-200 dark:border-gray-800">
                          <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{record.seq}</td>
                          <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{kind}</td>
                          <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{requestCell}</td>
                          <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{valuesCell}</td>
                          <td className="border border-gray-200 px-2 py-1 dark:border-gray-800"><code className="break-all font-mono text-xs">{rawCell}</code></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        ) : (
          <section role="tabpanel" id="serial-summary-panel" aria-labelledby="serial-summary-tab" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Capture
                <select
                  value={selectedCaptureId}
                  onChange={(event) => setSelectedCaptureId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="">Choose a capture</option>
                  {captures.map((capture) => (
                    <option key={capture.id} value={capture.id}>{`${capture.startedAt} (${capture.rxPath} / ${capture.txPath})`}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Battery voltage
                <input
                  type="number"
                  value={batteryVoltage}
                  onChange={(event) => setBatteryVoltage(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Reference reading
                <select
                  value={selectedGroundTruth}
                  onChange={(event) => setSelectedGroundTruth(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="">None</option>
                  {groundTruths.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.source ? `${snapshot.capturedAt} (${snapshot.source})` : snapshot.capturedAt}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={!selectedCaptureId || summaryLoading}
                  onClick={handleSummarise}
                  className="rounded-md bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
                >
                  Summarise
                </button>
              </div>
            </div>

            {summaryError && (
              <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{summaryError}</p>
            )}

            {summaryLoading && <p className="text-sm text-gray-600 dark:text-gray-400">Summarising…</p>}

            {summary && (
              <>
                <ul aria-label="Counts" className="grid gap-1 text-sm text-gray-700 dark:text-gray-300 sm:grid-cols-2">
                  <li>Pairs: {summary.counts.pairs}</li>
                  <li>Plausible: {summary.counts.plausible}</li>
                  <li>Implausible: {summary.counts.implausible}</li>
                  <li>Unknown: {summary.counts.unknown}</li>
                  <li>Unanswered: {summary.counts.unanswered}</li>
                  <li>Orphan responses: {summary.counts.orphan}</li>
                  <li>Reconnects: {summary.counts.reconnects}</li>
                </ul>

                {summary.suggestions &&
                  summary.suggestions.length > 0 &&
                  summary.suggestions.every((s) => Math.abs(s.gapMs) > FAR_FROM_CAPTURE_MS) && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      This reference reading is more than 30 minutes from anything in this capture, so its suggestions are weak evidence.
                    </p>
                  )}

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-gray-100 dark:bg-gray-900">
                      <tr>
                        <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Address</th>
                        <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Register</th>
                        <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Latest</th>
                        <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Category</th>
                        <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Seen</th>
                        <th className="border border-gray-200 px-2 py-1 text-left dark:border-gray-800">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.addresses.map((row) => {
                        const rowClass = row.category === 'implausible'
                          ? 'bg-red-50 dark:bg-red-950'
                          : row.category === 'unknown'
                            ? 'bg-amber-50 dark:bg-amber-950'
                            : '';

                        return (
                          <tr key={row.address} className={rowClass}>
                            <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{row.address}</td>
                            <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{row.name ?? '—'}</td>
                            <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{row.latestValue}</td>
                            <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{row.category}</td>
                            <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">{row.seen}</td>
                            <td className="border border-gray-200 px-2 py-1 dark:border-gray-800">
                              {suggestionFor(row.address) ? (
                                <NameSuggestions suggestion={suggestionFor(row.address)!} />
                              ) : (
                                (row.reason ?? '')
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {summary.unanswered.length > 0 && (
                  <>
                    <h2 className="text-base font-semibold">Unanswered requests</h2>
                    <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                      {summary.unanswered.map((item) => (
                        <li key={`${item.address}-${item.quantity}-${item.count}`}>
                          <span>{`${item.address} ×${item.quantity}`}</span> ({item.count})
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
