import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import PanelTypes from '../solar/PanelTypes';
import LocationForm from '../solar/LocationForm';
import SolarArrayForm from '../solar/SolarArrayForm';
import { usePanelTypes } from '../solar/usePanelTypes';

/** The user's panel types, and this inverter's array built from one of them. */
export default function SolarArrayPage() {
  const { t } = useTranslation();
  const { profileId: profileIdParam } = useParams<{ profileId: string }>();
  const profileId = Number(profileIdParam);
  const { user, refreshUser } = useAuth();
  const profile = user?.inverterProfiles.find((p) => p.id === profileId);
  const readOnly = profile?.role !== 'ADMIN';
  const { panelTypes, reload } = usePanelTypes();

  return (
    <div className="space-y-4">
      {!panelTypes || !profile ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <section aria-labelledby="array-title">
            <h2 id="array-title" className="sr-only">
              {t('solar.arrayOf', { name: profile.name })}
            </h2>
            <SolarArrayForm profile={profile} panelTypes={panelTypes} onSaved={() => void refreshUser()} readOnly={readOnly} />
          </section>
          <LocationForm
            profileId={profile.id}
            latitude={profile.latitude}
            longitude={profile.longitude}
            pvTiltDeg={profile.pvTiltDeg}
            pvFacingDeg={profile.pvFacingDeg}
            onSaved={() => void refreshUser()}
            readOnly={readOnly}
          />
          <section aria-labelledby="panel-types-title" className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
            <h2 id="panel-types-title" className="mb-3 text-[15px] font-semibold">
              {t('solar.panelTypes')}
            </h2>
            <PanelTypes panelTypes={panelTypes} onSaved={() => void reload()} readOnly={readOnly} />
          </section>
        </>
      )}
    </div>
  );
}
