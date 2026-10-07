

import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useEffect, useState } from 'react';
import { Button } from '../ui';
import { CopyButton } from '../ui/CopyButton';
import { Dialog } from '../ui/Dialog';

type Status = 'loading' | 'ready' | 'error';

/** Links the signed-in user's Telegram chat to the bot. */
export default function TelegramLink() {
  const [status, setStatus] = useState<Status>('loading');
  const [linked, setLinked] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">Telegram</h2>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}

      {status === 'ready' &&
        (linked ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="flex flex-1 items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-good" />
              A Telegram chat is linked.
            </p>
            <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              Unlink
            </Button>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-muted">Not linked. Alerts, /status and /energy come to a linked chat.</p>
            {code ? (
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm">{`/start ${code}`}</code>
                  <CopyButton text={`/start ${code}`} />
                </div>
                <p className="mt-2 text-xs text-muted">Send this to the bot within 10 minutes.</p>
              </div>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void handleGetCode()}>
                Get a link code
              </Button>
            )}
          </div>
        ))}

      <Dialog
        open={confirming}
        title="Unlink the Telegram chat?"
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void handleUnlink();
              }}
            >
              Unlink
            </Button>
          </>
        }
      >
        Alerts, summaries and replies stop coming to that chat.
      </Dialog>
    </section>
  );
}
