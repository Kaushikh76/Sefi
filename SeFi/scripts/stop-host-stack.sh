#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"
PID_FILE="${RUN_DIR}/backend.pid"

if [[ -f "${PID_FILE}" ]]; then
  BACKEND_PID="$(cat "${PID_FILE}")"
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "Stopping SeFi host backend (${BACKEND_PID})..."
    kill "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
fi

cd "${ROOT_DIR}"
docker compose down || true
docker builder prune -f 2>/dev/null || true
