#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"
LOG_FILE="${RUN_DIR}/backend.log"
TAIL_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${TAIL_PID}" ]] && kill -0 "${TAIL_PID}" 2>/dev/null; then
    kill "${TAIL_PID}" 2>/dev/null || true
    wait "${TAIL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ -f "${LOG_FILE}" ]]; then
  echo "Tailing host backend log from ${LOG_FILE}..."
  tail -n 100 -f "${LOG_FILE}" &
  TAIL_PID=$!
else
  echo "No detached backend log found at ${LOG_FILE}."
fi

cd "${ROOT_DIR}"
docker compose logs -f cube
