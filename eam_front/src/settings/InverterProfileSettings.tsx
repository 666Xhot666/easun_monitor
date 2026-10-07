import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useAuth } from '../auth/useAuth';
import { useLiveData } from '../shell/LiveData';
import { Button, Card, CardTitle } from '../ui';
import { Dialog } from '../ui/Dialog';

const BATTERY_TYPES = { LIFEPO4: 'LiFePO4', LEAD_ACID: 'Lead-acid (flooded)', GEL: 'GEL', USER_DEFINED: 'User-defined' };

/** The inverter as paired: how EAM reaches it and what it powers; removing it from EAM. */
export default function InverterProfileSettings() {
  const { profile } = useLiveData();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const canRemove = (user?.inverterProfiles.length ?? 0) > 1;

  async function remove() {
    setError('');
    try {
      await axios.delete(`/api/inverter/profiles/${profile.id}`);
      setConfirming(false);
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(extractErrorMessage(e, 'Couldn’t remove the inverter.'));
    }
  }

  const rows: [string, string][] = [
    ['Name', profile.name],
    ['Logger', `${profile.ipAddress} : ${profile.port}`],
    ['Rated power', `${(profile.ratedPowerWatts / 1000).toFixed(1)} kW`],
    ['Battery bank', `${profile.batteryNominalVoltage} V · ${BATTERY_TYPES[profile.batteryType]} · ${profile.batteryCapacityAh} Ah`],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Connection and battery bank</CardTitle>
        <dl className="mt-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-3 border-t border-line py-2 text-sm first:border-t-0">
              <dt className="flex-1 text-muted">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {canRemove && (
        <Card>
          <CardTitle>Remove inverter</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Removes {profile.name} from EAM. Its recorded history is kept; the inverter and its logger are not changed.
          </p>
          <div className="mt-4">
            <Button variant="danger-soft" onClick={() => setConfirming(true)}>
              Remove {profile.name}…
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-crit-ink">
              {error}
            </p>
          )}
        </Card>
      )}
      <Dialog
        open={confirming}
        title={`Remove ${profile.name}?`}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()}>
              Remove inverter
            </Button>
          </>
        }
      >
        EAM stops reading it. Its recorded history is kept.
      </Dialog>
    </div>
  );
}
