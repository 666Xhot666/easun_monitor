

import axios from '../lib/apiClient';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { extractErrorMessage } from '../lib/errors';
import { useEffect, useState } from 'react';
import { Button } from '../ui';
import { CopyButton } from '../ui/CopyButton';
import { Dialog } from '../ui/Dialog';

type Status = 'loading' | 'ready' | 'error';

/** Links the signed-in user's Telegram chat to the bot. */
export default function TelegramLink() {
  const { t } = useTranslation();
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
        setError(i18n.t('telegram.loadFailed'));
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
      setError(extractErrorMessage(err, t('telegram.unlinkFailed')));
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
      setError(extractErrorMessage(err, t('telegram.codeFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">{t('telegram.title')}</h2>

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
              {t('telegram.linked')}
            </p>
            <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              {t('telegram.unlink')}
            </Button>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-muted">{t('telegram.notLinked')}</p>
            {code ? (
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm">{`/start ${code}`}</code>
                  <CopyButton text={`/start ${code}`} />
                </div>
                <p className="mt-2 text-xs text-muted">{t('telegram.sendWithin')}</p>
              </div>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void handleGetCode()}>
                {t('telegram.getCode')}
              </Button>
            )}
          </div>
        ))}

      <Dialog
        open={confirming}
        title={t('telegram.unlinkTitle')}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void handleUnlink();
              }}
            >
              {t('telegram.unlink')}
            </Button>
          </>
        }
      >
        {t('telegram.unlinkBody')}
      </Dialog>
    </section>
  );
}
