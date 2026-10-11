#!/bin/sh
# Installs the serial logger, the BMS reader, the outage schedule reader or the
# server agent as a systemd service on Linux:
# it starts at boot and is restarted whenever it exits.
#
#   SERIAL_RX_PORT=/dev/serial/by-id/A SERIAL_TX_PORT=/dev/serial/by-id/B \
#     scripts/install-linux-service.sh serial-logger
#   scripts/install-linux-service.sh bms-reader
#   scripts/install-linux-service.sh outage-reader
#   scripts/install-linux-service.sh server-agent
#
# The server agent controls the fan named by SERVER_AGENT_FAN (its hwmon
# name; from the environment or its .env): the unit lets the agent's user
# write that fan's pwm1 files, and hands the fan back to the firmware
# whenever the agent stops (scripts/fan-access.sh, installed root-owned as
# /usr/local/libexec/easun-fan-access).
#
# Run as the user the service runs as (not root); it uses sudo. Build first:
# `cd eam_server && npx nest build`. The BMS reader, the outage reader and the
# server agent read their settings from their .env files, as when run by hand. Logs: journalctl -u easun-<name> -f
# Uninstall:
#   sudo systemctl disable --now easun-<name>
#   sudo rm /etc/systemd/system/easun-<name>.service

set -eu

NAME="${1:-}"
case "$NAME" in
    serial-logger|bms-reader|outage-reader|server-agent) ;;
    *)
    echo "Usage: $0 <serial-logger|bms-reader|outage-reader|server-agent>" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" -eq 0 ]; then
    echo "Run as the user the service should run as, not root" >&2
    exit 1
fi

UNIT="easun-$NAME"
SERVER_DIR=$(cd "$(dirname "$0")/../eam_server" && pwd)
RUN_USER=$(id -un)
NODE=$(command -v node) || { echo "node not found on PATH" >&2; exit 1; }

if [ ! -f "$SERVER_DIR/dist/$NAME/main.js" ]; then
    echo "Not built: run 'npx nest build' in $SERVER_DIR first" >&2
    exit 1
fi

if pgrep -f "dist/$NAME/main" >/dev/null 2>&1 && ! systemctl is-active --quiet "$UNIT"; then
    echo "A $NAME is already running outside systemd; stop it first:" >&2
    echo "  pkill -f dist/$NAME/main" >&2
    exit 1
fi

case "$NAME" in
    serial-logger)
        : "${SERIAL_RX_PORT:?SERIAL_RX_PORT is required}"
        : "${SERIAL_TX_PORT:?SERIAL_TX_PORT is required}"
        RX_BAUD="${SERIAL_RX_BAUD:-9600}"
        TX_BAUD="${SERIAL_TX_BAUD:-9600}"
        EXTRA="Environment=SERIAL_RX_PORT=$SERIAL_RX_PORT
Environment=SERIAL_TX_PORT=$SERIAL_TX_PORT
Environment=SERIAL_RX_BAUD=$RX_BAUD
Environment=SERIAL_TX_BAUD=$TX_BAUD"
        ;;
    bms-reader)
        # raw Bluetooth (HCI) access for this service only
        EXTRA="AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN"
        ;;
    outage-reader)
        EXTRA=""
        ;;
    server-agent)
        EXTRA=""
        FAN="${SERVER_AGENT_FAN:-$(sed -n 's/^SERVER_AGENT_FAN=//p' "$SERVER_DIR/.env" "$SERVER_DIR/../.env" 2>/dev/null | head -n 1)}"
        if [ -n "$FAN" ]; then
            # A root-owned copy: systemd runs it as root, so it must not be
            # a file the agent's user can change.
            ACCESS=/usr/local/libexec/easun-fan-access
            sudo install -D -o root -g root -m 0755 "$SERVER_DIR/../scripts/fan-access.sh" "$ACCESS"
            EXTRA="ExecStartPre=+$ACCESS grant $FAN $RUN_USER
ExecStopPost=+$ACCESS release $FAN"
            echo "The agent will run the fan $FAN"
        fi
        ;;
esac

sudo tee "/etc/systemd/system/$UNIT.service" >/dev/null <<EOF
[Unit]
Description=EASUN Monitor $NAME
After=network-online.target bluetooth.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$SERVER_DIR
ExecStart=$NODE dist/$NAME/main
$EXTRA
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$UNIT"
sudo systemctl restart "$UNIT"

echo "Installed $UNIT; logs: journalctl -u $UNIT -f"
