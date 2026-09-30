# eam_server

NestJS API and poller for EASUN Monitor. See the [root README](../README.md)
for setup and [CONTEXT.md](../CONTEXT.md) for the domain terms.

| Path | Contents |
| --- | --- |
| `src/inverter/protocol/` | Logger frame codec (wire format, CRC). |
| `src/inverter/registers/` | Register map and the SMG-II register table. |
| `src/inverter/link/` | Logger link, TCP transport, in-memory logger. |
| `src/inverter/` | Polling, settings, profiles and their HTTP endpoints. |
| `src/telemetry/` | Telemetry store: readings, history, hourly rollups. |
| `src/auth/` | Accounts, JWT access tokens, refresh cookies. |

```bash
npm run start:dev   # watch mode (needs DATABASE_URL, JWT_SECRET, POLLING_INTERVAL_MS)
npm test            # unit tests
npm run test:e2e    # API tests against the eam_test database
```
