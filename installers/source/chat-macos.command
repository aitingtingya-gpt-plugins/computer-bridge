#!/bin/zsh
set -eu
bridge_home="${COMPUTER_BRIDGE_HOME:-$HOME/.computer-bridge}"
bridge_python="$(cat "$bridge_home/launcher-python.txt")"
exec "$bridge_python" "$bridge_home/launcher.py" --home "$bridge_home" --command chat "$@"
