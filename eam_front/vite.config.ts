import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Lets the dev server bind to 0.0.0.0 so it's reachable from outside
    // the `frontend` container (docker-compose already passes --host via
    // the Dockerfile's CMD, this just keeps the config file itself honest
    // about it too).
    host: true,
    proxy: {
      // Any request the browser makes to /api/* is proxied server-side
      // from inside this container to the NestJS backend, so the React
      // app can call relative paths like `/api/inverter/latest` without
      // hardcoding a host/port or running into CORS in dev.
      '/api': {
        // Where the dev server forwards /api. Inside docker compose this is
        // the backend's service name (VITE_PROXY_TARGET=http://server:3000,
        // set in docker-compose.yml); running `npm run dev` on the host
        // falls back to the locally running backend.
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
