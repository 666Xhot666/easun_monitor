#!/bin/sh
# Lets the server agent's user run one fan, and hands the fan back to the
# firmware. Run as root, by the agent's systemd unit:
#
#   fan-access.sh grant <hwmon-name> <user>   before the agent starts
#   fan-access.sh release <hwmon-name>        after it stops, for any reason
#
# The fan is the hwmon device of that name with a pwm1. Without one, nothing
# is done: the agent then only reports.

set -eu

ACTION="${1:-}"
NAME="${2:-}"
if [ -z "$NAME" ] || { [ "$ACTION" != grant ] && [ "$ACTION" != release ]; }; then
    echo "Usage: $0 grant <hwmon-name> <user> | release <hwmon-name>" >&2
    exit 1
fi

for dir in /sys/class/hwmon/*; do
    [ "$(cat "$dir/name" 2>/dev/null)" = "$NAME" ] || continue
    [ -e "$dir/pwm1" ] || continue
    case "$ACTION" in
        grant)
            group=$(id -gn "${3:?user required}")
            chgrp "$group" "$dir/pwm1" "$dir/pwm1_enable"
            chmod g+w "$dir/pwm1" "$dir/pwm1_enable"
            ;;
        release)
            echo 2 > "$dir/pwm1_enable"
            ;;
    esac
    exit 0
done

echo "No fan device called $NAME with a pwm1" >&2
exit 0
