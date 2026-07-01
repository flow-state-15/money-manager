#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
PORT="${MONEY_MANAGER_PORT:-8765}"
HOST="127.0.0.1"

is_money_manager_pid() {
  local pid="$1"
  [[ -r "/proc/${pid}/cmdline" ]] || return 1
  local cmd
  cmd=$(tr '\0' ' ' < "/proc/${pid}/cmdline")
  [[ "${cmd}" == *"app.main"* ]]
}

pids_on_port() {
  lsof -t -i:"${PORT}" -sTCP:LISTEN 2>/dev/null || true
}

ensure_port_available() {
  local pids
  pids=$(pids_on_port)
  [[ -z "${pids}" ]] && return 0

  if curl -sf "http://${HOST}:${PORT}/api/health" >/dev/null 2>&1; then
    echo "Money Manager is already running at http://${HOST}:${PORT}/"
    echo "  Health: curl http://${HOST}:${PORT}/api/health"
    echo "Stop it with: ./stop.sh"
    echo "Or: kill $(lsof -t -i:${PORT} 2>/dev/null | tr '\n' ' ')"
    exit 0
  fi

  local pid all_ours=true
  for pid in ${pids}; do
    if ! is_money_manager_pid "${pid}"; then
      all_ours=false
      break
    fi
  done

  if [[ "${all_ours}" == true ]]; then
    echo "Stopping stale Money Manager on port ${PORT} (PID(s): ${pids})..."
    kill ${pids} 2>/dev/null || true
    sleep 0.5
    for pid in ${pids}; do
      if kill -0 "${pid}" 2>/dev/null; then
        kill -9 "${pid}" 2>/dev/null || true
      fi
    done
    sleep 0.2
    return 0
  fi

  echo "ERROR: port ${PORT} is in use by another program (not Money Manager)." >&2
  echo "Inspect: lsof -i :${PORT}" >&2
  echo "Free the port (only if safe): kill \$(lsof -t -i:${PORT})" >&2
  exit 1
}

ensure_port_available

if [[ -x "${ROOT}/.venv/bin/python3" ]]; then
  exec "${ROOT}/.venv/bin/python3" -m app.main
elif command -v uv >/dev/null 2>&1; then
  exec uv run python -m app.main
elif command -v python3 >/dev/null 2>&1; then
  exec python3 -m app.main
else
  echo "No Python found. From project root:" >&2
  echo "  uv venv && uv pip install -r requirements.txt" >&2
  echo "  ./run.sh" >&2
  exit 1
fi
