import { useParams } from 'react-router-dom';
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
  const readOnly = profile?.role !== 'ADMIN';
  const { panelTypes, reload } = usePanelTypes();
  const heading = 'mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

  return (
    <>
      <div className="space-y-10">
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
                readOnly={readOnly}
              />
            </section>
            <section aria-labelledby="panel-types-title">
              <h2 id="panel-types-title" className={heading}>
                Panel types
              </h2>
              <PanelTypes panelTypes={panelTypes} onSaved={() => void reload()} readOnly={readOnly} />
            </section>
          </>
        )}
      </div>
    </>
  );
}
