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
| `DEV_AUTO_LOGIN` | false | Development only: sign in automatically as `DEV_AUTO_LOGIN_EMAIL`. |
| `DEV_AUTO_LOGIN_EMAIL` | | Existing account that dev auto-login signs in as. |
| `DEV_SERIAL_SNIFF` | false | Development only: enable the serial sniff panel at `/dev/serial`. |
| `SERIAL_PORT` | | Serial port the sniff panel suggests, e.g. `/dev/cu.usbserial-…`. |

The `DEV_*` options do nothing when `NODE_ENV=production`, whatever their value.

## Developing without the inverter

```bash
node scripts/mock-inverter.ts
```

Then pair it in the wizard at `host.docker.internal` (Docker Desktop) or your
host's LAN IP (Docker on Linux), port 8899. Telemetry values move on every
read; settings keep their value and accept writes. To see alerts, start it with
fault or warning bits set, e.g. `MOCK_WARNING_CODE=16640 node scripts/mock-inverter.ts`.

## Development tools

Both tools work only when `NODE_ENV` is not `production` **and** their flag is
set; otherwise their routes answer 404.

**Auto-login.** With `DEV_AUTO_LOGIN=true` and `DEV_AUTO_LOGIN_EMAIL` set to an
existing account, a dev build of the frontend signs in as that account when it
loads without a session. It uses your own account rather than a separate
system user, so you see your inverters.

**Serial sniff.** For checking registers against the real device: a USB-serial
adapter on the Wi-Fi logger's TTL-side RX pad (9600 8N1) hears the inverter's
replies. With `DEV_SERIAL_SNIFF=true`, open `/dev/serial` in a dev build, pick
the port (prefer `/dev/cu.usbserial-*` over `tty.`) and start a capture. The
port is opened read-only in effect: nothing is ever written to it.

The tap is receive-only, so it never sees the requests: frames are listed in
capture order with their raw words, never with a register name. Pair a value
with its address by hand (for example, change a setting in the vendor app and
note which frame changed); the note field on each frame is for that.

Docker Desktop on macOS can't pass USB devices into containers, so for the
serial sniff run the server natively against the compose database:

```bash
docker compose up -d db
cd eam_server
DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:5432/$POSTGRES_DB" \
  DEV_SERIAL_SNIFF=true SERIAL_PORT=/dev/cu.usbserial-XXXX npm run start:dev
```

To run it unattended on a Mac, use a dedicated standard (non-admin) macOS user
rather than your own login or root, and start it with launchd:

```bash
sudo sysadminctl -addUser easun-monitor -fullName "EASUN Monitor" -password -   # prompts; no -admin
sudo cp com.easun-monitor.server.plist /Library/LaunchDaemons/
sudo launchctl bootstrap system /Library/LaunchDaemons/com.easun-monitor.server.plist
```

A minimal `com.easun-monitor.server.plist` (adjust paths; build first with
`npm run build`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.easun-monitor.server</string>
  <key>UserName</key><string>easun-monitor</string>
  <key>WorkingDirectory</key><string>/Users/Shared/easun_monitor/eam_server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/main</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>development</string>
    <key>DEV_SERIAL_SNIFF</key><string>true</string>
    <key>SERIAL_PORT</key><string>/dev/cu.usbserial-XXXX</string>
    <key>DATABASE_URL</key><string>postgresql://eam_user:CHANGE_ME@localhost:5432/eam_db</string>
    <key>JWT_SECRET</key><string>CHANGE_ME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/Shared/easun_monitor/server.log</string>
  <key>StandardErrorPath</key><string>/Users/Shared/easun_monitor/server.err.log</string>
</dict>
</plist>
```

`NODE_ENV=development` is what keeps the serial sniff available; leave it out
(or set `production`) once you no longer need it.

USB-serial adapters (CP210x, CH340, FTDI) are usually readable by any local
user on macOS, but check yours: if the service logs a permission error opening
the port, the driver needs a grant for that user.

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
