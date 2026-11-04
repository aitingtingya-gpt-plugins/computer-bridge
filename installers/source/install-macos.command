#!/bin/zsh
set -eu
base="${0:A:h}"
server="${1:-}"
if [[ -z "$server" ]]; then
  read "server?服务端地址（https://你的域名，不加 /mcp）："
fi
python_bin="${COMPUTER_BRIDGE_PYTHON:-python3}"
if [[ $# -gt 1 ]]; then
  exec "$python_bin" "$base/install.py" --server "$server" --name "$2"
fi
exec "$python_bin" "$base/install.py" --server "$server"
