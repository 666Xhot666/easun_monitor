import { NavLink, Navigate, useParams } from 'react-router-dom';
import BmsSetup from '../bms/BmsSetup';
import { useLiveData } from '../shell/LiveData';
import TelegramLink from '../telegram/TelegramLink';
import { PageHeader } from '../ui';
import AccountSettings from '../settings/AccountSettings';
import InverterProfileSettings from '../settings/InverterProfileSettings';
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
  { slug: 'inverter', label: 'Inverter', reader: false },
  { slug: 'inverter-settings', label: 'Inverter settings', reader: false },
  { slug: 'solar', label: 'Solar array', reader: false },
  { slug: 'battery-monitor', label: 'Battery monitor', reader: false },
  { slug: 'household', label: 'Household', reader: true },
  { slug: 'notifications', label: 'Notifications', reader: true },
  { slug: 'account', label: 'Account', reader: true },
];

const READER_TABS: Tab[] = [{ slug: 'configuration', label: 'Current configuration', reader: true }, ...ADMIN_TABS.filter((t) => t.reader)];

/** Configuration for this inverter and the household, one tab per area. */
export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const { profile, isAdmin } = useLiveData();
  const tabs = isAdmin ? ADMIN_TABS : READER_TABS;
  const base = `/dashboard/${profile.id}/settings`;

  if (!tab || !tabs.some((t) => t.slug === tab)) return <Navigate to={`${base}/${tabs[0].slug}`} replace />;

  return (
    <>
      <PageHeader title="Settings" subtitle="Configuration for this inverter and your household" />
      <nav aria-label="Settings" className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {tabs.map((t) => (
          <NavLink
            key={t.slug}
            to={`${base}/${t.slug}`}
            className={({ isActive }) =>
              'flex-none border-b-2 px-3 pt-1 pb-3 text-[15px] whitespace-nowrap transition ' +
              (isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {tab === 'inverter' && <InverterProfileSettings />}
      {(tab === 'inverter-settings' || tab === 'configuration') && <InverterSettings />}
      {tab === 'solar' && <SolarArrayPage />}
      {tab === 'battery-monitor' && <BmsSetup profileId={profile.id} readOnly={!isAdmin} />}
      {tab === 'household' && <HouseholdPage />}
      {tab === 'notifications' && <TelegramLink />}
      {tab === 'account' && <AccountSettings />}
    </>
  );
}
