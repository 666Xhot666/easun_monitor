import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLocale } from '../i18n';
import LanguageSwitch from '../i18n/LanguageSwitch';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useAuth } from '../auth/useAuth';
import { ageText, useNow } from '../shell/age';
import { useTheme } from '../theme/useTheme';
import type { ThemePreference } from '../theme/theme';
import { Button, Card, CardTitle, Segmented } from '../ui';
import { Dialog } from '../ui/Dialog';
import { describeUserAgent } from './userAgent';

const THEMES: ThemePreference[] = ['light', 'dark', 'system'];

/** GET /api/auth/sessions. */
interface Session {
  id: string;
  userAgent: string | null;
  signedInAt: string;
  lastUsedAt: string;
  current: boolean;
}

const input = 'mt-1 h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink';

/** The signed-in user's email, password, appearance, language and signed-in browsers. */
export default function AccountSettings() {
  const { t } = useTranslation();
  const { user, logoutEverywhere } = useAuth();
  const { preference, setPreference } = useTheme();
  const now = useNow(60_000);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [signingOut, setSigningOut] = useState<Session | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [password, setPassword] = useState<{ state: 'idle' | 'saving' } | { state: 'done' } | { state: 'failed'; message: string }>({
    state: 'idle',
  });

  async function loadSessions() {
    try {
      const { data } = await axios.get<Session[]>('/api/auth/sessions');
      setSessions(data);
    } catch {
      setSessions([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    axios
      .get<Session[]>('/api/auth/sessions')
      .then(({ data }) => !cancelled && setSessions(data))
      .catch(() => !cancelled && setSessions([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPassword({ state: 'saving' });
    try {
      await axios.post('/api/auth/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setPassword({ state: 'done' });
      void loadSessions();
    } catch (e) {
      setPassword({ state: 'failed', message: extractErrorMessage(e, t('account.passwordFailed')) });
    }
  }

  async function signOut(session: Session) {
    setSigningOut(null);
    await axios.delete(`/api/auth/sessions/${session.id}`).catch(() => {});
    void loadSessions();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{t('account.profile')}</CardTitle>
        <p className="mt-3 text-xs text-muted">{t('common.email')}</p>
        <p className="text-[15px]">{user?.email}</p>
      </Card>

      <Card>
        <form onSubmit={(e) => void changePassword(e)}>
          <CardTitle>{t('account.password')}</CardTitle>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              {t('account.currentPassword')}
              <input type="password" autoComplete="current-password" className={input} value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <div>
              <label className="block text-sm font-medium">
                {t('account.newPassword')}
                <input type="password" autoComplete="new-password" minLength={8} className={input} value={next} onChange={(e) => setNext(e.target.value)} />
              </label>
              <p className="mt-1 text-xs text-muted">{t('auth.atLeast', { count: 8 })}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!current || next.length < 8 || password.state === 'saving'}>
              {t('account.changePassword')}
            </Button>
            {password.state === 'done' && <p className="text-sm text-good-ink">{t('account.passwordChanged')}</p>}
            {password.state === 'failed' && (
              <p role="alert" className="text-sm text-crit-ink">
                {password.message}
              </p>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>{t('account.appearance')}</CardTitle>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <Segmented
            ariaLabel={t('account.theme')}
            options={THEMES.map((value) => ({ value, label: t(`account.themes.${value}`) }))}
            value={preference}
            onChange={setPreference}
          />
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <span className="text-xs text-muted">{t('account.languageHint')}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>{t('account.sessions')}</CardTitle>
        {sessions === null ? (
          <div className="mt-3 h-24 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <ul className="mt-2">
            {sessions.map((s) => {
              const name = describeUserAgent(s.userAgent);
              return (
                <li key={s.id} aria-label={name} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">{name}</span>
                    <span className="block text-xs text-muted">{t('account.signedIn', { date: new Date(s.signedInAt).toLocaleDateString(currentLocale()) })}</span>
                  </span>
                  <span className="text-[13px] text-muted">{s.current ? t('common.now') : t('common.ago', { age: ageText(now - Date.parse(s.lastUsedAt)) })}</span>
                  {s.current ? (
                    <span className="text-xs font-semibold text-good-ink">{t('account.thisDevice')}</span>
                  ) : (
                    <Button size="sm" aria-label={t('account.signOutNamed', { name })} onClick={() => setSigningOut(s)}>
                      {t('shell.signOut')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3">
          <Button variant="danger-soft" onClick={() => setConfirmingAll(true)}>
            {t('shell.signOutEverywhereMenu')}
          </Button>
        </div>
      </Card>

      <Dialog
        open={signingOut !== null}
        title={t('account.signOutNamedTitle', { name: signingOut ? describeUserAgent(signingOut.userAgent) : '' })}
        onClose={() => setSigningOut(null)}
        actions={
          <>
            <Button onClick={() => setSigningOut(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => signingOut && void signOut(signingOut)}>
              {t('shell.signOut')}
            </Button>
          </>
        }
      >
        {t('account.signOutNamedBody')}
      </Dialog>
      <Dialog
        open={confirmingAll}
        title={t('shell.signOutEverywhereTitle')}
        onClose={() => setConfirmingAll(false)}
        actions={
          <>
            <Button onClick={() => setConfirmingAll(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => void logoutEverywhere()}>
              {t('shell.signOutEverywhere')}
            </Button>
          </>
        }
      >
        {t('shell.signOutEverywhereBody', { email: user?.email })}
      </Dialog>
    </div>
  );
}
