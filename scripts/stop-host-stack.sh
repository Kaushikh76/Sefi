#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"
PID_FILE="${RUN_DIR}/backend.pid"
: "${SEFI_PORT:=3210}"

# Load .env so custom port overrides are honored.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
  set +a
fi

if [[ -f "${PID_FILE}" ]]; then
  BACKEND_PID="$(cat "${PID_FILE}")"
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "Stopping SeFi host backend (${BACKEND_PID})..."
    kill "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
fi

if command -v lsof >/dev/null 2>&1; then
  PORT_PID="$(lsof -nP -t -iTCP:"${SEFI_PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "${PORT_PID}" ]]; then
    CMDLINE="$(ps -p "${PORT_PID}" -o command= 2>/dev/null || true)"
    if [[ "${CMDLINE}" == *"node src/server.js"* ]]; then
      echo "Stopping SeFi host backend on port ${SEFI_PORT} (${PORT_PID})..."
      kill "${PORT_PID}" 2>/dev/null || true
      wait "${PORT_PID}" 2>/dev/null || true
    fi
  fi
fi

cd "${ROOT_DIR}"
docker compose down || true
docker builder prune -f 2>/dev/null || true
