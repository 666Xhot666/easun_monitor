

import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useEffect, useState } from 'react';

type Status = 'loading' | 'ready' | 'error';

/** Links the signed-in user's Telegram chat to the bot. */
export default function TelegramLink() {
  const [status, setStatus] = useState<Status>('loading');
  const [linked, setLinked] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await axios.get<{ linked: boolean }>('/api/telegram/link');
        if (cancelled) {
          return;
        }
        setLinked(response.data.linked);
        setError(null);
        setStatus('ready');
      } catch {
        if (cancelled) {
          return;
        }
        setError('Could not load the Telegram link.');
        setStatus('error');
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleUnlink = async () => {
    if (!window.confirm('Unlink the Telegram chat? Alerts stop coming there.')) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await axios.delete('/api/telegram/link');
      setLinked(false);
      setCode(null);
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not unlink the chat.'));
    } finally {
      setBusy(false);
    }
  };

  const handleGetCode = async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await axios.post<{ code: string; expiresAt: string }>('/api/telegram/link-code');
      setCode(response.data.code);
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not get a code.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 space-y-3 rounded-lg border border-gray-200 bg-gray-100 p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-medium">Telegram</h2>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {status === 'ready' &&
        (linked ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">A Telegram chat is linked.</p>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              disabled={busy}
              onClick={() => {
                void handleUnlink();
              }}
            >
              Unlink
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">Not linked. Alerts, /status and /energy come to a linked chat.</p>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              disabled={busy}
              onClick={() => {
                void handleGetCode();
              }}
            >
              Get a link code
            </button>

            {code && (
              <div className="space-y-2">
                <code className="select-all rounded bg-gray-100 px-2 py-1 font-mono text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">{`/start ${code}`}</code>
                <p className="text-sm text-gray-700 dark:text-gray-300">Send this to the bot within 10 minutes.</p>
              </div>
            )}
          </div>
        ))}
    </section>
  );
}
