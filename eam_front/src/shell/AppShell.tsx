import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BatteryMedium,
  Bell,
  ChartLine,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Clock,
  CircleAlert,
  LayoutGrid,
  Plus,
  Settings,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useAuth } from '../auth/useAuth';
import type { InverterProfile } from '../auth/types';
import { describeDeviceStatus } from '../inverter/useDeviceStatus';
import { Button, Dot } from '../ui';
import { Dialog } from '../ui/Dialog';
import { LiveDataProvider, useLiveData } from './LiveData';
import { ageText, useNow } from './age';
import type { SystemState } from './systemState';

const DESTINATIONS: { to: string; label: string; Icon: LucideIcon }[] = [
  { to: '', label: 'Overview', Icon: LayoutGrid },
  { to: 'battery', label: 'Battery', Icon: BatteryMedium },
  { to: 'history', label: 'History', Icon: ChartLine },
  { to: 'alerts', label: 'Alerts', Icon: Bell },
  { to: 'settings', label: 'Settings', Icon: Settings },
];

const ratedKw = (profile: InverterProfile) => `${(profile.ratedPowerWatts / 1000).toFixed(1)} kW`;

const STATE_TONE: Record<SystemState, 'good' | 'warn' | 'crit' | 'idle'> = {
  loading: 'idle',
  waiting: 'idle',
  live: 'good',
  fault: 'crit',
  stale: 'warn',
  offline: 'warn',
};

/**
 * The app around every inverter page: sidebar (desktop) or bottom tabs
 * (phone), a top bar with the inverter switcher, live status and account
 * menu, and a banner while the system is not healthy.
 */
export default function AppShell() {
  const { user } = useAuth();
  const { profileId } = useParams<{ profileId: string }>();
  const profiles = useMemo(() => user?.inverterProfiles ?? [], [user]);
  const profile = profiles.find((p) => p.id === Number(profileId));
  const navigate = useNavigate();

  // A stale or deleted id lands on the first inverter instead of a dead end.
  useEffect(() => {
    if (!profile && profiles[0]) navigate(`/dashboard/${profiles[0].id}`, { replace: true });
  }, [profile, profiles, navigate]);

  if (!profile) return null;
  return (
    <LiveDataProvider key={profile.id} profile={profile}>
      <ShellLayout />
    </LiveDataProvider>
  );
}

function ShellLayout() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex min-h-screen bg-page text-ink">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <StatusBanner />
        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-12">
          <Outlet />
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}

function useBase() {
  const { profile } = useLiveData();
  return `/dashboard/${profile.id}`;
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const base = useBase();
  const { user } = useAuth();
  const { profile } = useLiveData();
  const household = user?.households.find((h) => h.id === profile.householdId);
  return (
    <aside
      className={
        'sticky top-0 hidden h-screen flex-none flex-col border-r border-line bg-side p-3 md:flex ' +
        (collapsed ? 'w-[68px]' : 'w-[232px]')
      }
    >
      <div className="mb-5 flex h-12 items-center gap-2.5 px-2">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-ink text-xs font-bold text-page">E</span>
        {!collapsed && <span className="text-[17px] font-semibold">EAM</span>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {DESTINATIONS.map(({ to, label, Icon }) => (
          <NavLink
            key={label}
            to={to ? `${base}/${to}` : base}
            end={to === ''}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              'flex h-10 items-center gap-3 rounded-lg px-2.5 text-[15px] transition ' +
              (isActive ? 'bg-accent-bg font-medium text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink')
            }
          >
            <Icon className="h-[18px] w-[18px] flex-none" />
            <span className={collapsed ? 'sr-only' : ''}>{label}</span>
          </NavLink>
        ))}
      </nav>
      {household && !collapsed && (
        <div className="mt-auto border-t border-line px-2.5 pt-4">
          <p className="text-xs text-muted">Household</p>
          <p className="mt-0.5 text-sm">
            {household.name} · {household.role === 'ADMIN' ? 'Admin' : 'Reader'}
          </p>
        </div>
      )}
    </aside>
  );
}

function BottomTabs() {
  const base = useBase();
  return (
    <nav
      aria-label="Main (phone)"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {DESTINATIONS.map(({ to, label, Icon }) => (
        <NavLink
          key={label}
          to={to ? `${base}/${to}` : base}
          end={to === ''}
          className={({ isActive }) =>
            'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ' +
            (isActive ? 'font-semibold text-ink' : 'text-muted')
          }
        >
          <Icon className="h-5 w-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-[61px] items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
      <InverterSwitcher />
      <StatusPill />
      <AccountMenu />
    </header>
  );
}

/** Closes a popup on Esc or a click outside `ref`. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function InverterSwitcher() {
  const { user } = useAuth();
  const { profile, systemState } = useLiveData();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const profiles = user?.inverterProfiles ?? [];
  // Keep the page when switching: /dashboard/1/battery -> /dashboard/2/battery.
  const rest = pathname.replace(/^\/dashboard\/\d+/, '');
  const household = user?.households.find((h) => h.id === profile.householdId);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-surface-2"
      >
        <Dot tone={STATE_TONE[systemState]} />
        <span className="font-semibold">{profile.name}</span>
        <span className="hidden text-muted sm:inline">SMG-II {ratedKw(profile)}</span>
        <ChevronsUpDown className="h-4 w-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-12 z-40 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted">Inverters{household ? ` in ${household.name}` : ''}</p>
          {profiles.map((p) => (
            <Link
              key={p.id}
              role="menuitem"
              to={`/dashboard/${p.id}${rest}`}
              onClick={() => setOpen(false)}
              className={
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2 ' +
                (p.id === profile.id ? 'bg-surface-2' : '')
              }
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted">SMG-II {ratedKw(p)}</span>
              </span>
              {p.id === profile.id && <span className="text-xs text-muted">Current</span>}
            </Link>
          ))}
          {user?.adminHouseholdId != null && (
            <>
              <div className="my-1 border-t border-line" />
              <Link
                role="menuitem"
                to="/setup"
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2"
              >
                <Plus className="h-4 w-4" />
                Add inverter
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill() {
  const { systemState, reading } = useLiveData();
  const now = useNow();
  const age = reading ? now - Date.parse(reading.timestamp) : 0;
  const pill: Record<SystemState, { label: string; className: string; sub?: string }> = {
    loading: { label: 'Connecting…', className: 'bg-surface-2 text-muted', sub: 'Waiting for the first reading' },
    waiting: { label: 'Waiting', className: 'bg-surface-2 text-muted', sub: 'No reading yet' },
    live: { label: 'Live', className: 'bg-good-bg text-good-ink', sub: `Updated ${ageText(age)} ago` },
    fault: { label: 'Fault', className: 'bg-crit-bg text-crit-ink', sub: `Updated ${ageText(age)} ago` },
    stale: { label: 'Stale', className: 'bg-warn-bg text-warn-ink', sub: `No new readings for ${ageText(age)}` },
    offline: {
      label: 'Offline',
      className: 'bg-warn-bg text-warn-ink',
      sub: reading ? `Last reading ${new Date(reading.timestamp).toLocaleTimeString()}` : undefined,
    },
  };
  const { label, className, sub } = pill[systemState];
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium ' + className}>
        <Dot tone={STATE_TONE[systemState]} />
        {label}
      </span>
      {sub && <span className="hidden truncate text-[13px] text-muted lg:inline">{sub}</span>}
    </div>
  );
}

function AccountMenu() {
  const { user, logout, logoutEverywhere } = useAuth();
  const base = useBase();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const email = user?.email ?? '';
  const item = 'flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2';

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-3 rounded-lg p-1 text-sm text-muted hover:text-ink"
      >
        <span className="hidden sm:inline">{email}</span>
        <span className="grid h-8 w-8 place-items-center rounded-full border border-line-strong bg-surface-2 text-[13px] font-semibold text-ink">
          {email.charAt(0).toUpperCase()}
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          <p className="truncate px-2.5 pt-1.5 pb-2 text-xs text-muted">{email}</p>
          <Link role="menuitem" to={`${base}/settings/account`} onClick={() => setOpen(false)} className={item}>
            Account settings
          </Link>
          <div className="my-1 border-t border-line" />
          <button role="menuitem" type="button" onClick={logout} className={item}>
            Sign out
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
            className={item + ' text-crit-ink'}
          >
            Sign out everywhere…
          </button>
        </div>
      )}
      <Dialog
        open={confirming}
        title="Sign out everywhere?"
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void logoutEverywhere()}>
              Sign out everywhere
            </Button>
          </>
        }
      >
        Every browser and phone signed in to {email} will need the password again.
      </Dialog>
    </div>
  );
}

function Banner({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: 'warn' | 'crit';
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={
        'flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6 ' +
        (tone === 'crit' ? 'border-crit-line bg-crit-bg text-crit-ink' : 'border-warn-line bg-warn-bg text-warn-ink')
      }
    >
      <span className="flex-none">{icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{title}</p>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}

function StatusBanner() {
  const { systemState, reading, readingStatus, deviceStatus, isAdmin, profile } = useLiveData();
  const [confirming, setConfirming] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState('');
  const now = useNow();
  const readAt = reading ? new Date(reading.timestamp).toLocaleTimeString() : null;

  async function exitFaultMode() {
    setExiting(true);
    setError('');
    try {
      await axios.post(`/api/inverter/${profile.id}/exit-fault-mode`);
      setConfirming(false);
    } catch (e) {
      setError(extractErrorMessage(e, 'Couldn’t clear the fault.'));
    } finally {
      setExiting(false);
    }
  }

  if (systemState === 'fault') {
    const fault = reading?.alerts?.faults[0];
    return (
      <>
        <Banner
          tone="crit"
          icon={<CircleAlert className="h-5 w-5" />}
          title={fault ? `Fault: ${fault}` : 'Fault: the inverter is in fault mode'}
          action={
            isAdmin && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Exit fault mode
              </Button>
            )
          }
        >
          {fault ? 'The inverter is in fault mode. ' : ''}Exit fault mode once the cause is fixed.
          {error && ` ${error}`}
        </Banner>
        <Dialog
          open={confirming}
          title="Exit fault mode?"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="danger" disabled={exiting} onClick={() => void exitFaultMode()}>
                Exit fault mode
              </Button>
            </>
          }
        >
          The inverter clears the fault and tries to resume normal operation. If the cause is still there, it
          goes back into fault mode.
        </Dialog>
      </>
    );
  }
  if (systemState === 'stale') {
    const age = reading ? ageText(now - Date.parse(reading.timestamp)) : '';
    return (
      <Banner tone="warn" icon={<Clock className="h-5 w-5" />} title={`No new readings for ${age}`}>
        The logger is connected but the inverter stopped answering. Values below are from {readAt}.
      </Banner>
    );
  }
  if (systemState === 'offline') {
    const serverDown = readingStatus === 'unreachable';
    const reason = !serverDown && deviceStatus ? describeDeviceStatus(deviceStatus) : null;
    return (
      <Banner
        tone="warn"
        icon={<WifiOff className="h-5 w-5" />}
        title={serverDown ? 'Can’t reach the EAM server' : 'Can’t reach the inverter logger'}
      >
        {serverDown ? 'Retrying every few seconds.' : reason}
        {readAt && ` Values below are from the last successful read at ${readAt}.`}
      </Banner>
    );
  }
  return null;
}
