import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useTheme } from '../theme/useTheme';
import type { ThemePreference } from '../theme/theme';
import { Button, Card, CardTitle, Segmented } from '../ui';
import { Dialog } from '../ui/Dialog';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** The signed-in user's email, appearance and sessions. */
export default function AccountSettings() {
  const { user, logoutEverywhere } = useAuth();
  const { preference, setPreference } = useTheme();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Profile</CardTitle>
        <p className="mt-3 text-xs text-muted">Email</p>
        <p className="text-[15px]">{user?.email}</p>
      </Card>
      <Card>
        <CardTitle>Appearance</CardTitle>
        <div className="mt-3">
          <Segmented ariaLabel="Theme" options={THEMES} value={preference} onChange={setPreference} />
        </div>
      </Card>
      <Card>
        <CardTitle>Sessions</CardTitle>
        <p className="mt-2 text-sm text-muted">Sign out of EAM on every browser and phone, including this one.</p>
        <div className="mt-4">
          <Button variant="danger-soft" onClick={() => setConfirming(true)}>
            Sign out everywhere…
          </Button>
        </div>
      </Card>
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
        Every browser and phone signed in to {user?.email} will need the password again.
      </Dialog>
    </div>
  );
}
