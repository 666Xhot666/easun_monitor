import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { Badge } from '../ui';
import { Switch } from '../ui/Switch';

/** GET /api/server/users item. */
interface ServerUser {
  id: number;
  email: string;
  owner: boolean;
  viewer: boolean;
}

/** The owner's choice of who may look at the server page; they only look, settings stay the owner's. */
export default function ServerAccess() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ServerUser[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios
      .get<ServerUser[]>('/api/server/users')
      .then(({ data }) => {
        if (!cancelled) setUsers(data);
      })
      .catch((e) => {
        if (!cancelled) setError(extractErrorMessage(e, i18n.t('server.access.loadFailed')));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setViewer = async (user: ServerUser, viewer: boolean) => {
    const mark = (on: boolean) => setUsers((list) => list?.map((u) => (u.id === user.id ? { ...u, viewer: on } : u)) ?? null);
    setError('');
    // Shown at once; put back if the server refuses.
    mark(viewer);
    try {
      await axios.put(`/api/server/users/${user.id}`, { viewer });
    } catch (e) {
      mark(!viewer);
      setError(extractErrorMessage(e, t('server.access.saveFailed')));
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">{t('server.access.title')}</h2>
      <p className="mt-1 text-[13px] text-muted">{t('server.access.hint')}</p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
      {!users && !error && <div className="mt-4 h-24 animate-pulse rounded-lg bg-surface-2" />}
      {users && (
        <ul className="mt-3 divide-y divide-line">
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="truncate">{user.email}</span>
              {user.owner ? (
                <Badge>{t('server.access.owner')}</Badge>
              ) : (
                <Switch label={t('server.access.mayLook', { email: user.email })} on={user.viewer} onChange={(on) => void setViewer(user, on)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
