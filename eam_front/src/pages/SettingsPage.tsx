import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import BmsSetup from '../bms/BmsSetup';
import OutageSetup from '../outage/OutageSetup';
import ServerAccess from '../server/ServerAccess';
import ServerAgentSetup from '../server/ServerAgentSetup';
import { useLiveData } from '../shell/LiveData';
import TelegramLink from '../telegram/TelegramLink';
import { PageHeader } from '../ui';
import AccountSettings from '../settings/AccountSettings';
import InverterProfileSettings from '../settings/InverterProfileSettings';
import NotificationSettings from '../settings/NotificationSettings';
import HouseholdPage from './HouseholdPage';
import InverterSettings from './InverterSettings';
import SolarArrayPage from './SolarArrayPage';

interface Tab {
  slug: string;
  label: string;
  /** Readers see only these tabs; everything else is admin configuration. */
  reader: boolean;
}

const ADMIN_TABS: Tab[] = [
  { slug: 'inverter', label: 'settings.tabs.inverter', reader: false },
  { slug: 'inverter-settings', label: 'settings.tabs.inverter-settings', reader: false },
  { slug: 'solar', label: 'settings.tabs.solar', reader: false },
  { slug: 'battery-monitor', label: 'settings.tabs.battery-monitor', reader: false },
  { slug: 'outage-schedule', label: 'settings.tabs.outage-schedule', reader: true },
  { slug: 'household', label: 'settings.tabs.household', reader: true },
  { slug: 'notifications', label: 'settings.tabs.notifications', reader: true },
  { slug: 'account', label: 'settings.tabs.account', reader: true },
];

/** The server owner's, whatever their household role. */
const OWNER_TAB: Tab = { slug: 'server-access', label: 'settings.tabs.server-access', reader: true };

const READER_TABS: Tab[] = [{ slug: 'configuration', label: 'settings.tabs.configuration', reader: true }, ...ADMIN_TABS.filter((t) => t.reader)];

/** Configuration for this inverter and the household, one tab per area. */
export default function SettingsPage() {
  const { t: translate } = useTranslation();
  const { tab } = useParams<{ tab?: string }>();
  const { profile, isAdmin } = useLiveData();
  const { user } = useAuth();
  const tabs = [...(isAdmin ? ADMIN_TABS : READER_TABS), ...(user?.server === 'OWNER' ? [OWNER_TAB] : [])];
  const base = `/dashboard/${profile.id}/settings`;

  if (!tab || !tabs.some((t) => t.slug === tab)) return <Navigate to={`${base}/${tabs[0].slug}`} replace />;

  return (
    <>
      <PageHeader title={translate('settings.title')} subtitle={translate('settings.subtitle')} />
      <nav aria-label={translate('settings.nav')} className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {tabs.map((t) => (
          <NavLink
            key={t.slug}
            to={`${base}/${t.slug}`}
            className={({ isActive }) =>
              'flex-none border-b-2 px-3 pt-1 pb-3 text-[15px] whitespace-nowrap transition ' +
              (isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')
            }
          >
            {translate(t.label)}
          </NavLink>
        ))}
      </nav>
      {tab === 'inverter' && <InverterProfileSettings />}
      {(tab === 'inverter-settings' || tab === 'configuration') && <InverterSettings />}
      {tab === 'solar' && <SolarArrayPage />}
      {tab === 'battery-monitor' && <BmsSetup profileId={profile.id} readOnly={!isAdmin} />}
      {tab === 'outage-schedule' && <OutageSetup profileId={profile.id} readOnly={!isAdmin} />}
      {tab === 'household' && <HouseholdPage />}
      {tab === 'notifications' && (
        <div className="space-y-4">
          <TelegramLink />
          <NotificationSettings showServer={Boolean(user?.server)} />
        </div>
      )}
      {tab === 'account' && <AccountSettings />}
      {tab === 'server-access' && (
        <div className="space-y-4">
          <ServerAgentSetup />
          <ServerAccess />
        </div>
      )}
    </>
  );
}
