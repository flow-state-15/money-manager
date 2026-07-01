#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${MONEY_MANAGER_PORT:-8765}"

is_money_manager_pid() {
  local pid="$1"
  [[ -r "/proc/${pid}/cmdline" ]] || return 1
  local cmd
  cmd=$(tr '\0' ' ' < "/proc/${pid}/cmdline")
  [[ "${cmd}" == *"app.main"* ]]
}

pids=$(lsof -t -i:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
if [[ -z "${pids}" ]]; then
  echo "No process listening on port ${PORT}."
  exit 0
fi

stopped=0
for pid in ${pids}; do
  if is_money_manager_pid "${pid}"; then
    echo "Stopping Money Manager (PID ${pid})..."
    kill "${pid}" 2>/dev/null || true
    stopped=1
  else
    echo "Skipping PID ${pid} (not app.main — inspect with: ps -p ${pid} -o args=)" >&2
  fi
done

if [[ "${stopped}" -eq 0 ]]; then
  echo "Nothing to stop (port ${PORT} held by non–Money Manager process)." >&2
  echo "Inspect: lsof -i :${PORT}" >&2
  exit 1
fi

sleep 0.5
for pid in ${pids}; do
  if is_money_manager_pid "${pid}" && kill -0 "${pid}" 2>/dev/null; then
    kill -9 "${pid}" 2>/dev/null || true
  fi
done

echo "Stopped."
