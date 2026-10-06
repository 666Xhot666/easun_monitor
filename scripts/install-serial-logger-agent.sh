#!/bin/sh
# Installs the serial logger as a macOS launchd agent: it starts at login,
# is restarted whenever it exits, and keeps the Mac awake on AC power.
#
#   SERIAL_RX_PORT=/dev/cu.usbserial-A SERIAL_TX_PORT=/dev/cu.usbserial-B \
#     scripts/install-serial-logger-agent.sh
#
# Run from a shell where `node` is the one to use (nvm is not on launchd's
# PATH, so its absolute path is written into the agent). Build first:
# `cd eam_server && npx nest build`. Uninstall:
#   launchctl bootout gui/$(id -u)/local.easun.serial-logger
#   rm ~/Library/LaunchAgents/local.easun.serial-logger.plist
set -eu

LABEL=local.easun.serial-logger
SERVER_DIR=$(cd "$(dirname "$0")/../eam_server" && pwd)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="${SERIAL_LOGGER_LOG:-$HOME/serial-logger.log}"
NODE=$(command -v node) || { echo "node not found on PATH" >&2; exit 1; }

: "${SERIAL_RX_PORT:?Set SERIAL_RX_PORT to the tap on the logger RX pad}"
: "${SERIAL_TX_PORT:?Set SERIAL_TX_PORT to the tap on the logger TX pad}"
RX_BAUD="${SERIAL_RX_BAUD:-9600}"
TX_BAUD="${SERIAL_TX_BAUD:-9600}"

if [ ! -f "$SERVER_DIR/dist/serial-logger/main.js" ]; then
  echo "Not built: run 'npx nest build' in $SERVER_DIR first" >&2
  exit 1
fi

# A copy started by hand (nohup) would hold the serial ports and TCP 8899.
if pgrep -f "dist/serial-logger/main" >/dev/null && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "A serial logger is already running outside launchd; stop it first:" >&2
  echo "  pkill -f dist/serial-logger/main" >&2
  exit 1
fi

mkdir -p "$(dirname "$PLIST")"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-is</string>
    <string>$NODE</string>
    <string>dist/serial-logger/main</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SERVER_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SERIAL_RX_PORT</key>
    <string>$SERIAL_RX_PORT</string>
    <key>SERIAL_TX_PORT</key>
    <string>$SERIAL_TX_PORT</string>
    <key>SERIAL_RX_BAUD</key>
    <string>$RX_BAUD</string>
    <key>SERIAL_TX_BAUD</key>
    <string>$TX_BAUD</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL; logging to $LOG"
