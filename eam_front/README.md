# eam_front

React + Vite dashboard for EASUN Monitor. See the [root README](../README.md)
for setup.

```bash
npm run dev    # dev server on :5173, proxies /api to VITE_PROXY_TARGET or localhost:3000
npm test       # Vitest + Testing Library
npm run build  # production bundle (served by nginx in the production image)
```

Register names, labels and units come from the server
(`GET /api/inverter/registers`); don't hard-code them here.
