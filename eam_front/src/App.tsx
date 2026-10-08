import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ThemeProvider } from './theme/useTheme'
import {
  RequireAuth,
  RequireInverterProfile,
  RedirectIfAuthenticated,
  DashboardIndexRedirect,
} from './auth/RouteGuards'
import AppShell from './shell/AppShell'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const SetupWizard = lazy(() => import('./pages/SetupWizard'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const BatteryPage = lazy(() => import('./pages/BatteryPage'))
const JoinPage = lazy(() => import('./pages/JoinPage'))
const Dashboard = lazy(() => import('./Dashboard'))
const AlertsPage = lazy(() => import('./pages/AlertsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const DevSerialSniff = import.meta.env.DEV ? lazy(() => import('./pages/DevSerialSniff')) : null

function PageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <p className="text-sm text-muted">Loading…</p>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route element={<RedirectIfAuthenticated />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Route>

            <Route element={<RequireAuth />}>
              {/* Reachable even once a user already has one or more paired
                  inverters — that's how "+ Add inverter" pairs another one. */}
              <Route path="/setup" element={<SetupWizard />} />

              {/* Dev builds only; the server also refuses outside development. */}
              {DevSerialSniff && <Route path="/dev/serial" element={<DevSerialSniff />} />}

              <Route element={<RequireInverterProfile />}>
                <Route path="/dashboard" element={<DashboardIndexRedirect />} />
                <Route path="/dashboard/:profileId" element={<AppShell />}>
                  <Route index element={<Dashboard />} />
                  <Route path="battery" element={<BatteryPage />} />
                  <Route path="history" element={<HistoryPage />} />
                  <Route path="alerts" element={<AlertsPage />} />
                  <Route path="settings/:tab?" element={<SettingsPage />} />
                  {/* Old addresses, kept so bookmarks still land. */}
                  <Route path="logs" element={<Navigate to="../history" relative="path" replace />} />
                  <Route path="solar" element={<Navigate to="../settings/solar" relative="path" replace />} />
                  <Route path="household" element={<Navigate to="../settings/household" relative="path" replace />} />
                </Route>
              </Route>
            </Route>

            {/* Signed in or not: the page offers joining, signing up or signing in. */}
            <Route path="/join/:code" element={<JoinPage />} />

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
