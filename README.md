# EASUN Monitor

A self-hosted web dashboard for an EASUN ISOLAR SMG-II inverter, talking to
it over your home network through its Wi-Fi Plug Pro logger: live values,
history from an hour to years, faults and warnings, and inverter settings
you can read and change, without the vendor's cloud app.

Terms used in the code (Logger, Register map, Reading, Logger link, ...)
are defined in [CONTEXT.md](CONTEXT.md).

## How it fits together

| Part | What it does |
| --- | --- |
| `eam_server` | NestJS + Prisma. Polls every paired inverter, stores readings in PostgreSQL, serves the API. |
| `eam_front` | React + Vite dashboard: live values, history chart, settings page, setup wizard. |
| `db` | PostgreSQL 16. Raw readings are kept forever; hourly rollups serve long ranges. |
| `scripts/mock-inverter.ts` | Simulator of an SMG-II behind a Wi-Fi Plug Pro, for development. |

The server wakes the logger with a UDP handshake (port 58899), then reads and
writes registers over TCP (port 8899) using the framing from the vendor's
"SMG-RS232 Communication Protocol V1.0.1".

## Requirements

- Docker with Docker Compose.
- The server must reach the logger on your LAN (UDP 58899 and TCP 8899).
- For the simulator and running tests on the host: Node.js 24.

## Install

```bash
cp .env.example .env
# set JWT_SECRET, e.g.:  openssl rand -base64 48
# change POSTGRES_PASSWORD
docker compose up --build
```

Open http://localhost:5173, create your account (the first account can always
register; after that sign-up is closed unless `ALLOW_REGISTRATION=true`), and
pair your inverter in the setup wizard:

1. Enter the logger's LAN IP address and port (8899), then **Verify Logger**.
   This does a full round trip, so success means the device answered.
2. Enter the installation's rated power and battery details.

Database migrations run automatically when the server container starts.

For a production build set `BUILD_TARGET=production` and `NODE_ENV=production`
in `.env`. The frontend is then served by nginx on the same port.

## Settings

All configuration is in `.env` (see `.env.example` for every option):

| Variable | Default | Meaning |
| --- | --- | --- |
| `POLLING_INTERVAL_MS` | 5000 | How often telemetry is read. |
| `SETTINGS_REFRESH_MS` | 300000 | How often inverter settings are re-read. |
| `INVERTER_TIMEOUT_MS` | 3000 | Timeout for the handshake, connect and each reply. |
| `ALLOW_PUBLIC_LOGGER_HOSTS` | false | Only LAN, loopback and link-local loggers are allowed unless true. |
| `ALLOW_REGISTRATION` | false | Allow more accounts after the first. |
| `JWT_EXPIRES_IN` | 15m | Access-token lifetime; sessions renew from a refresh cookie. |
| `REFRESH_TOKEN_TTL_DAYS` | 30 | How long a sign-in lasts without use. |

## Developing without the inverter

```bash
node scripts/mock-inverter.ts
```

Then pair it in the wizard at `host.docker.internal` (Docker Desktop) or your
host's LAN IP (Docker on Linux), port 8899. Telemetry values move on every
read; settings keep their value and accept writes. To see alerts, start it with
fault or warning bits set, e.g. `MOCK_WARNING_CODE=16640 node scripts/mock-inverter.ts`.

## Tests

```bash
cd eam_server
npm test            # unit tests: codec, Register map, Logger link, TCP transport
npm run test:e2e    # API tests against the compose Postgres, in a separate eam_test database

cd ../eam_front
npm test            # component and hook tests (Vitest)
```

The e2e tests expect the `db` container to be running and an `eam_test`
database with migrations applied:

```bash
docker exec eam_db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE DATABASE eam_test"
cd eam_server && DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5432/eam_test" npx prisma migrate deploy
```

## Troubleshooting

- **"Inverter logger unreachable (UDP handshake timed out)"**: the server
  can't reach the logger. Check the IP, that the logger is on the same
  network, and that UDP 58899 isn't blocked. The server backs off and retries
  on its own; the dashboard shows when it will try next.
- **Verify Logger says the address is not on a private network**: use the
  logger's LAN address, or set `ALLOW_PUBLIC_LOGGER_HOSTS=true`.
- **The first hourly rollup is slow on a large database**: it runs once in
  the background (a few minutes per year of 5-second readings) and afterwards
  only processes the latest hour or two.
- **Known limit**: the connection direction (server dials the logger) is
  confirmed against the simulator; confirming it on a real Wi-Fi Plug Pro is
  still open.
