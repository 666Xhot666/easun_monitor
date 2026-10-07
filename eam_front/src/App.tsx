import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ThemeProvider } from './theme/useTheme'
import {
  RequireAuth,
  RequireInverterProfile,
  RedirectIfAuthenticated,
  DashboardIndexRedirect,
} from './auth/RouteGuards'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import SetupWizard from './pages/SetupWizard'
import HistoryPage from './pages/HistoryPage'
import BatteryPage from './pages/BatteryPage'
import JoinPage from './pages/JoinPage'
import Dashboard from './Dashboard'
import AppShell from './shell/AppShell'
import AlertsPage from './pages/AlertsPage'
import SettingsPage from './pages/SettingsPage'
import DevSerialSniff from './pages/DevSerialSniff'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
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
            {import.meta.env.DEV && <Route path="/dev/serial" element={<DevSerialSniff />} />}

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
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
