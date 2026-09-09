import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
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
import Dashboard from './Dashboard'

function App() {
  return (
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

          <Route element={<RequireInverterProfile />}>
            <Route path="/dashboard" element={<DashboardIndexRedirect />} />
            <Route path="/dashboard/:profileId" element={<Dashboard />} />
            <Route path="/dashboard/:profileId/settings" element={<InverterSettings />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
