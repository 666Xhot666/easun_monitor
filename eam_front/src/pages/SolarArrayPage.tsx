import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import PanelTypes from '../solar/PanelTypes';
import SolarArrayForm from '../solar/SolarArrayForm';
import { usePanelTypes } from '../solar/usePanelTypes';

/** The user's panel types, and this inverter's array built from one of them. */
export default function SolarArrayPage() {
  const { profileId: profileIdParam } = useParams<{ profileId: string }>();
  const profileId = Number(profileIdParam);
  const { user, refreshUser } = useAuth();
  const profile = user?.inverterProfiles.find((p) => p.id === profileId);
  const { panelTypes, reload } = usePanelTypes();
  const heading = 'mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-4xl">
          <Link to={`/dashboard/${profileId}`} className="text-xs text-gray-500 hover:underline dark:text-gray-400">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Solar array</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-10 px-6 py-8">
        {!panelTypes || !profile ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : (
          <>
            <section aria-labelledby="array-title">
              <h2 id="array-title" className={heading}>
                {profile.name}'s array
              </h2>
              <SolarArrayForm
                profile={profile}
                panelTypes={panelTypes}
                onSaved={() => void refreshUser()}
              />
            </section>
            <section aria-labelledby="panel-types-title">
              <h2 id="panel-types-title" className={heading}>
                Panel types
              </h2>
              <PanelTypes panelTypes={panelTypes} onSaved={() => void reload()} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
