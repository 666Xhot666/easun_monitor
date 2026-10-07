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
import InverterSettings from './pages/InverterSettings'
import ReadingsLogPage from './pages/ReadingsLogPage'
import SolarArrayPage from './pages/SolarArrayPage'
import BatteryPage from './pages/BatteryPage'
import HouseholdPage from './pages/HouseholdPage'
import JoinPage from './pages/JoinPage'
import Dashboard from './Dashboard'
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
              <Route path="/dashboard/:profileId" element={<Dashboard />} />
              <Route path="/dashboard/:profileId/settings" element={<InverterSettings />} />
              <Route path="/dashboard/:profileId/logs" element={<ReadingsLogPage />} />
              <Route path="/dashboard/:profileId/solar" element={<SolarArrayPage />} />
              <Route path="/dashboard/:profileId/battery" element={<BatteryPage />} />
              <Route path="/dashboard/:profileId/household" element={<HouseholdPage />} />
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
