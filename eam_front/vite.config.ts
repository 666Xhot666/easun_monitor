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
        // `server` is the backend's service name on the compose network
        // (see docker-compose.yml) — reachable as a hostname only from
        // inside another container on that same network. Running the
        // frontend outside Docker (`npm run dev` directly on your host)
        // needs this switched to http://localhost:3000 instead, since
        // `server` won't resolve there.
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
