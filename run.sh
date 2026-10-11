#!/usr/bin/env bash
# Launch J.A.R.V.I.S.  (extra args are passed through, e.g. --windowed, --screen HDMI-A-1)
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PY="$DIR/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "J.A.R.V.I.S. is not installed yet - running install.sh first..."
  "$DIR/install.sh" || exit 1
fi
cd "$DIR" && exec "$PY" -m jarvis "$@"
