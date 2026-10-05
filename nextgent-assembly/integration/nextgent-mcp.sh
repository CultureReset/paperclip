#!/usr/bin/env bash
# Launch the existing platform MCP with the same durable store as core/link.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${NEXTGENT_OWNER_ID:?Set the same owner ID used by the local core}"
: "${NEXTGENT_DB_PATH:?Set the shared absolute local-core SQLite database path}"
case "$NEXTGENT_DB_PATH" in
  /*) ;;
  *) printf '%s\n' 'NEXTGENT_DB_PATH must be absolute so Jarvis and core share one action ledger' >&2; exit 1 ;;
esac
export NEXTGENT_MAPS_DIR="${NEXTGENT_MAPS_DIR:-$ROOT/repos/nextgent-maps-main}"
export PYTHONPATH="$ROOT/repos/nextgent-platform-main/src${PYTHONPATH:+:$PYTHONPATH}"
if [[ -n "${NEXTGENT_PYTHON:-}" ]]; then
  python_bin="$NEXTGENT_PYTHON"
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  python_bin="$ROOT/.venv/bin/python"
else
  python_bin=python3
fi
exec "$python_bin" -m nextgent.mcp_server
