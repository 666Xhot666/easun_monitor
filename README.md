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
| `ALLOW_REGISTRATION` | false | Allow more accounts after the first (sign-up with a household invite works regardless). |
| `TELEGRAM_BOT_TOKEN` | | Bot token from @BotFather; the Telegram bot is off without it. |
| `TELEGRAM_LOW_SOC` | 20 | Battery level (%) that triggers a low-battery alert. |
| `TELEGRAM_SUMMARY_TIME` | 21:00 | When the daily evening summary is sent. |
| `TIME_ZONE` | UTC | Time zone for the summary time and for "today" in `/energy`. |
| `JWT_EXPIRES_IN` | 15m | Access-token lifetime; sessions renew from a refresh cookie. |
| `REFRESH_TOKEN_TTL_DAYS` | 30 | How long a sign-in lasts without use. |
| `DEV_AUTO_LOGIN` | false | Development only: sign in automatically as `DEV_AUTO_LOGIN_EMAIL`. |
| `DEV_AUTO_LOGIN_EMAIL` | | Account dev auto-login signs in as; created if it doesn't exist. |
| `DEV_SERIAL_SNIFF` | false | Development only: enable the serial capture panel at `/dev/serial`. |
| `SERIAL_RX_PORT` | | Port of the tap on the logger's RX pad (responses), e.g. `/dev/cu.usbserial-…`. |
| `SERIAL_TX_PORT` | | Port of the tap on the logger's TX pad (requests). |
| `SERIAL_RX_BAUD` / `SERIAL_TX_BAUD` | 9600 | Baud rate of each tap's USB side. |
| `DEV_CAPTURE_DIR` | .dev-captures | Where captures are saved, one JSON-lines file each. |

The `DEV_*` options do nothing when `NODE_ENV=production`, whatever their value.

## Households

Inverters, panel types and BMS devices belong to a household. Members have a
role:

- **Admin**: everything, including members and invites. A user is admin of
  one household at most.
- **Reader**: sees everything, changes nothing. A reader can belong to several
  households.

A new account gets its own household as admin. To add someone, an admin opens
**Household** on the dashboard and creates an invite with a role. The invite
is a code or a `/join/<code>` link, single-use, valid for 7 days.

- Signing up with an invite code joins that household instead of creating
  one. This works even with `ALLOW_REGISTRATION=false`.
- An existing user who joins gives up their own household if it has no
  inverters. With inverters, they can join other households only as a reader.
- A household always keeps at least one admin.

## Telegram bot

With `TELEGRAM_BOT_TOKEN` set, the server runs a Telegram bot (long polling:
no public address needed).

- **Linking:** on the Household page, get a code and send `/start <code>` to
  the bot within 10 minutes. One chat per user; `/stop` unlinks it.
- **Commands:** `/status` (mode, power flow, battery) and `/energy` (today's
  totals) for every inverter in the user's households.
- **Alerts** go to the linked chats of every member of the inverter's
  household: new faults and warnings, faults cleared, grid lost and restored,
  battery at or below `TELEGRAM_LOW_SOC` (again after it recovers 5 points),
  BMS alarms, and a logger or BMS reader silent for 5 minutes and back.
  After a server restart the first reading is the baseline.
- **Evening summary:** the day's energy per inverter at
  `TELEGRAM_SUMMARY_TIME`.

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

**Auto-login.** With `DEV_AUTO_LOGIN=true` and `DEV_AUTO_LOGIN_EMAIL` set, a
dev build of the frontend signs in as that account when it loads without a
session, with no password. On a fresh install the account is created on the
spot (with a random password nobody needs), so there is no registration step.
Use your own email, so it is your account that owns the paired inverters.

**Serial capture.** For checking registers against the real device, two taps
on the Wi-Fi logger's TTL-side pads listen to its conversation with the
inverter: a USB-serial adapter on the RX pad hears the inverter's responses,
and a second device on the TX pad hears the logger's requests. The second
device can be an Arduino Nano running a SoftwareSerial passthrough on pins
other than D0/D1; set `SERIAL_TX_BAUD` to whatever the sketch's USB side uses.
Set the ports with `SERIAL_RX_PORT` and `SERIAL_TX_PORT` (prefer
`/dev/cu.usbserial-*` over `tty.`); both bauds default to 9600.

With `DEV_SERIAL_SNIFF=true`, open `/dev/serial` in a dev build, check both
ports and start a capture. Nothing is ever written to either port. Each request
is paired with the next response whose size fits it (2 bytes per requested
register) within a second; the two taps may report in either order. A request
with no fitting response is unanswered, a response with no request an orphan.
Values are named from the register map. Write requests (function `0x10`) are
counted but not decoded.

If a port fails (for example macOS's "device reports readiness to read but
returned no data"), it is reopened with backoff from 1 s up to 30 s, and the
outage is recorded in the capture. Every capture is saved as a JSON-lines file
in `DEV_CAPTURE_DIR` (default `.dev-captures` in the server's working
directory), so it outlives the page and the server.

The Summary tab summarises any saved capture: how many addresses were
plausible (a known register with a value inside its options or range),
implausible (a known register with a value outside them) or unknown (not in the
register map, shown raw), plus unanswered requests, orphan responses and
reconnects, and one row per address with its latest value. Enter the battery
voltage to also check values against that battery's ranges. The capture never
edits the register map: unknown addresses are for a person to review and add.

Docker Desktop on macOS can't pass USB devices into containers, so for the
serial capture run the server natively against the compose database:

```bash
docker compose up -d db
docker compose stop server    # one server per logger, and port 3000 is needed
cd eam_server
set -a; source ../.env; set +a  # the server only reads a .env in its own directory
export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:${DB_PORT:-5432}/$POSTGRES_DB"
npm run start:dev
```

`DATABASE_URL` is not in `.env`: docker-compose builds it from the `POSTGRES_*`
values, so a native run has to do the same.

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
    <key>SERIAL_RX_PORT</key><string>/dev/cu.usbserial-XXXX</string>
    <key>SERIAL_TX_PORT</key><string>/dev/cu.usbserial-YYYY</string>
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

`NODE_ENV=development` is what keeps the serial capture available; leave it out
(or set `production`) once you no longer need it.

USB-serial adapters (CP210x, CH340, FTDI) are usually readable by any local
user on macOS, but check yours: if the service logs a permission error opening
the port, the driver needs a grant for that user.

## Serial mode (serial logger service)

Serial mode feeds the dashboard from the two USB-serial taps on the Wi-Fi
logger's TTL pads, instead of the app talking to the logger over Wi-Fi. The
taps only listen, so the vendor app keeps working.

A separate service, the serial logger, runs natively on the machine the taps
are plugged into (Docker on macOS can't reach USB devices); the main app can
stay in Docker. To the main app the service looks exactly like the Wi-Fi
logger. Start it from `eam_server` with the two tap devices:

```bash
cd eam_server
SERIAL_RX_PORT=/dev/cu.usbserial-A SERIAL_TX_PORT=/dev/cu.usbserial-B npm run serial-logger
```

`SERIAL_RX_BAUD` and `SERIAL_TX_BAUD` default to 9600; `SERIAL_LOGGER_TCP_PORT`
and `SERIAL_LOGGER_UDP_PORT` to 8899 and 58899. Pair it in the setup wizard at
`host.docker.internal` (main app in Docker) or the machine's address, port 8899.

The service can only report what the real logger reads, and the real logger
reads the inverter about every 5 minutes. Between those reads it keeps
answering with the last values, so set `POLLING_INTERVAL_MS=30000` rather than
the default 5 seconds. Until the logger has read a register at least once, the
service answers it with an error instead of a made-up value, so nothing false
is stored.

To run it as a launchd agent (starts at login, restarts when it exits, keeps
the Mac awake on AC power), build it (`npx nest build` in `eam_server`) and
run from the repository root:

```bash
SERIAL_RX_PORT=/dev/cu.usbserial-A SERIAL_TX_PORT=/dev/cu.usbserial-B scripts/install-serial-logger-agent.sh
```

Log: `~/serial-logger.log`. Uninstall: see the script's header.

Serial mode is read-only: settings writes are refused, and nothing is written
to the taps or the inverter. The service keeps saving the two-tap capture files
in `DEV_CAPTURE_DIR`, so register discovery continues while it runs. Only one
program can open a serial port, so stop the serial logger before using the
`/dev/serial` capture panel, and the other way round.

## Battery (BMS) reader

Reads a JK BMS over Bluetooth (read-only) and posts its readings to the
server. Runs natively on a Mac within Bluetooth range of the battery.

```bash
cd eam_server
npx prisma generate                   # once after cloning, and after schema changes
npm run bms-reader -- --scan          # list nearby peripherals: signal, id, name
npm run bms-reader                    # read and deliver
npm run bms-reader -- --decode .dev-captures/bms/<file>.jsonl   # re-decode a capture
```

Settings (see `.env.example`): `BMS_NAME`, `BMS_ID`, `BMS_PROTOCOL`,
`BMS_INGEST_URL`, `BMS_INGEST_TOKEN`, `BMS_SEND_INTERVAL_MS`. Read from the
environment, then `eam_server/.env`, then the repository's `.env`.

- `BMS_ID`: the id shown by `--scan`. `BMS_NAME`: a name prefix (default `JK-`).
- `BMS_INGEST_URL` and `BMS_INGEST_TOKEN`: shown when the BMS is added in
  Settings > Battery monitor (BMS). Without them the reader only captures.
- macOS asks for Bluetooth permission for the terminal app on first use. It
  cannot be granted over SSH.
- The JK phone app cannot connect while the reader is connected.
- Each session writes `.dev-captures/bms/<start>.jsonl` with the raw frames.

The decoder is ported from
[syssi/esphome-jk-bms](https://github.com/syssi/esphome-jk-bms) (Apache-2.0),
commit `59c994e`.

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

## License

MIT, see [LICENSE](LICENSE).
