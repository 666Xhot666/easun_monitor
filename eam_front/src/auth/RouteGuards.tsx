import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

function FullScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
    </div>
  );
}

/** Wrap any route tree that requires a logged-in user. */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullScreenLoading />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

/**
 * Wrap the dashboard route tree: requires auth *and* a paired inverter.
 * Nested under <RequireAuth/> in the route tree below, so by the time
 * this runs `isAuthenticated` is already guaranteed true.
 */
export function RequireInverterProfile() {
  const { hasInverterProfile, isLoading } = useAuth();

  if (isLoading) return <FullScreenLoading />;
  if (!hasInverterProfile) {
    return <Navigate to="/setup" replace />;
  }
  return <Outlet />;
}

/** Wrap /login and /register: an already-logged-in user shouldn't see
 * the auth forms again — send them wherever they'd otherwise land. */
export function RedirectIfAuthenticated() {
  const { isAuthenticated, hasInverterProfile, isLoading } = useAuth();

  if (isLoading) return <FullScreenLoading />;
  if (isAuthenticated) {
    return <Navigate to={hasInverterProfile ? '/dashboard' : '/setup'} replace />;
  }
  return <Outlet />;
}


/**
 * Landing target for the bare `/dashboard` path — picks the user's most
 * recently updated paired inverter and redirects to its own
 * `/dashboard/:profileId`, so every dashboard view (deep-linkable,
 * bookmarkable, shareable) always names a specific device rather than
 * relying on implicit "whichever one was active" state. Only ever
 * rendered under <RequireInverterProfile/>, so `inverterProfiles` is
 * guaranteed non-empty here.
 */
export function DashboardIndexRedirect() {
  const { user } = useAuth();
  const firstProfileId = user?.inverterProfiles[0]?.id;

  if (!firstProfileId) {
    // Defensive only — RequireInverterProfile already guarantees this
    // won't happen in practice.
    return <Navigate to="/setup" replace />;
  }

  return <Navigate to={`/dashboard/${firstProfileId}`} replace />;
}
