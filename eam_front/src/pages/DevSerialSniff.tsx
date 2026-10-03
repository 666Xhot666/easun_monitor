import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';

/** One inverter reply heard on the serial tap, numbered in capture order. */
interface CapturedFrame {
  seq: number;
  receivedAt: string;
  unit: number;
  func: number;
  byteCount: number;
  words: number[];
  hex: string;
  note?: string;
}

/** GET /api/dev/serial */
interface SniffState {
  running: boolean;
  path: string | null;
  error: string | null;
  defaultPath: string | null;
  frames: CapturedFrame[];
}

/** Frames kept on screen; the server keeps its own, larger buffer. */
const MAX_FRAMES = 2000;

/**
 * Dev-only serial sniff panel: listens to the inverter's replies on a
 * receive-only tap of the Wi-Fi logger and lists the frames it hears. The
 * server answers only in development with DEV_SERIAL_SNIFF=true.
 */
export default function DevSerialSniff({ pollMs = 1000 }: { pollMs?: number }) {
  const [state, setState] = useState<Omit<SniffState, 'frames'> | null>(null);
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [path, setPath] = useState('');
  const [off, setOff] = useState(false);
  const [error, setError] = useState('');
  const lastSeq = useRef(0);
  const pathTouched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const { data } = await axios.get<SniffState>(`/api/dev/serial?since=${lastSeq.current}`);
        if (cancelled) return;
        const { frames, ...status } = data;
        setState(status);
        if (!pathTouched.current) setPath(status.path ?? status.defaultPath ?? '');
        const incoming = frames.filter((frame) => frame.seq > lastSeq.current);
        if (incoming.length) {
          lastSeq.current = incoming[incoming.length - 1].seq;
          setFrames((current) => [...current, ...incoming].slice(-MAX_FRAMES));
        }
      } catch (err) {
        if (cancelled) return;
        if ((err as { response?: { status?: number } }).response?.status === 404) setOff(true);
        else setError(extractErrorMessage(err, "Couldn't reach the serial sniffer."));
      }
    }
    void poll();
    const interval = setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  async function control(action: 'start' | 'stop') {
    setError('');
    try {
      const { data } = await axios.post<Omit<SniffState, 'frames' | 'defaultPath'>>(
        `/api/dev/serial/${action}`,
        action === 'start' ? { path } : undefined,
      );
      setState((s) => ({ defaultPath: s?.defaultPath ?? null, ...data }));
    } catch (err) {
      setError(extractErrorMessage(err, `Couldn't ${action} the capture.`));
    }
  }

  if (off) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-sm text-gray-600 dark:text-gray-300">
        <p>
          The serial sniffer is off. Run the server outside production with <code>DEV_SERIAL_SNIFF=true</code> (and
          optionally <code>SERIAL_PORT=/dev/cu.usbserial-…</code>) on the machine wired to the logger.
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-6xl">
          <Link to="/dashboard" className="text-xs text-gray-500 hover:underline dark:text-gray-400">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Serial sniff (dev)</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          This tap is receive-only: it hears the inverter's replies but not the requests, so it can't tell which address
          a value came from. Frames are shown in capture order only; pair them with addresses by hand, e.g. with a note.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-gray-600 dark:text-gray-300">
            Serial port
            <input
              value={path}
              onChange={(e) => {
                pathTouched.current = true;
                setPath(e.target.value);
              }}
              placeholder="/dev/cu.usbserial-…"
              className="mt-1 w-72 rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
          </label>
          {state?.running ? (
            <button
              type="button"
              onClick={() => void control('stop')}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Stop capture
            </button>
          ) : (
            <button
              type="button"
              disabled={!path.trim()}
              onClick={() => void control('start')}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Start capture
            </button>
          )}
          <span role="status" className="text-sm text-gray-500 dark:text-gray-400">
            {state?.running ? `Listening on ${state.path}` : 'Stopped'}
          </span>
        </div>
        {(error || state?.error) && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error || state?.error}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Unit / func / bytes</th>
                <th className="px-3 py-2">Words</th>
                <th className="px-3 py-2">Raw</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {frames.map((frame) => (
                <FrameRow key={frame.seq} frame={frame} />
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function FrameRow({ frame }: { frame: CapturedFrame }) {
  const [note, setNote] = useState(frame.note ?? '');
  const [saved, setSaved] = useState(false);

  async function save() {
    await axios.post(`/api/dev/serial/frames/${frame.seq}/note`, { note });
    setSaved(true);
  }

  return (
    <tr className="font-mono text-gray-800 dark:text-gray-200">
      <td className="px-3 py-1.5">{frame.seq}</td>
      <td className="px-3 py-1.5">{new Date(frame.receivedAt).toLocaleTimeString()}</td>
      <td className="px-3 py-1.5">
        {frame.unit} / {frame.func} / {frame.byteCount}
      </td>
      <td className="px-3 py-1.5">{frame.words.join(', ')}</td>
      <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{frame.hex}</td>
      <td className="px-3 py-1.5">
        <span className="flex items-center gap-1">
          <input
            aria-label={`Note for frame ${frame.seq}`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
            className="w-48 rounded border border-gray-300 px-2 py-0.5 font-sans dark:border-gray-700 dark:bg-gray-950"
          />
          <button
            type="button"
            aria-label={`Save note for frame ${frame.seq}`}
            onClick={() => void save().catch(() => setSaved(false))}
            className="rounded px-1.5 py-0.5 font-sans text-blue-600 hover:underline dark:text-blue-400"
          >
            {saved ? 'Saved' : 'Save'}
          </button>
        </span>
      </td>
    </tr>
  );
}
