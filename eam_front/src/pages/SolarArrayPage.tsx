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

  return (
    <div className="space-y-4">
      {!panelTypes || !profile ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <section aria-labelledby="array-title">
            <h2 id="array-title" className="sr-only">
              {profile.name}'s array
            </h2>
            <SolarArrayForm profile={profile} panelTypes={panelTypes} onSaved={() => void refreshUser()} readOnly={readOnly} />
          </section>
          <section aria-labelledby="panel-types-title" className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
            <h2 id="panel-types-title" className="mb-3 text-[15px] font-semibold">
              Panel types
            </h2>
            <PanelTypes panelTypes={panelTypes} onSaved={() => void reload()} readOnly={readOnly} />
          </section>
        </>
      )}
    </div>
  );
}
