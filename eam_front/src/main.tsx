import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './lib/apiClient'
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
