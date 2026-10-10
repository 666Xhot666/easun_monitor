import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './lib/apiClient'
// Served with the app instead of from Google Fonts: no render-blocking
// third-party request, and the app works without internet access.
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/instrument-sans/latin-500.css'
import '@fontsource/instrument-sans/latin-600.css'
import '@fontsource/instrument-sans/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './index.css'
import { applyTheme, loadPreference, resolveTheme, systemPrefersDark } from './theme/theme'
import App from './App.tsx'

// Before the first paint, so a dark-theme user never sees a light flash.
applyTheme(resolveTheme(loadPreference(), systemPrefersDark()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
