#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"
PID_FILE="${RUN_DIR}/backend.pid"
LOG_FILE="${RUN_DIR}/backend.log"

: "${SEFI_PORT:=3210}"
: "${SEFI_NETWORK:=testnet}"
: "${SEFI_NETWORKS:=mainnet,testnet}"
: "${SEFI_CUBE_API_TOKEN:=sefi-local-dev}"

# Load project env so agent/runtime secrets are available to backend and compose.
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
  set +a
fi

export SEFI_PORT
export SEFI_NETWORK
export SEFI_NETWORKS
export SEFI_CUBE_API_TOKEN

DETACH=0
BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --detach)
      DETACH=1
      ;;
    --build)
      BUILD=1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

mkdir -p "${RUN_DIR}"

if [[ -f "${PID_FILE}" ]]; then
  EXISTING_PID="$(cat "${PID_FILE}")"
  if [[ -n "${EXISTING_PID}" ]] && kill -0 "${EXISTING_PID}" 2>/dev/null; then
    echo "SeFi host backend is already running with PID ${EXISTING_PID}."
    exit 0
  fi
  rm -f "${PID_FILE}"
fi

find_listener_pid() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  lsof -nP -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

is_backend_healthy() {
  local port="$1"
  local health_url="http://127.0.0.1:${port}/api/v1/health"
  curl -fsS "${health_url}" >/dev/null 2>&1
}

cd "${ROOT_DIR}"

echo "Preparing host SQLite database and Cube snapshot..."
node ./backend/src/prepare-cube-snapshot.js

COMPOSE_ARGS=(up -d)
if [[ "${BUILD}" -eq 1 ]]; then
  COMPOSE_ARGS+=(--build)
fi
COMPOSE_ARGS+=(cube)

echo "Starting Cube in Docker..."
docker compose "${COMPOSE_ARGS[@]}"

PORT_PID="$(find_listener_pid "${SEFI_PORT}")"
if [[ -n "${PORT_PID}" ]]; then
  if is_backend_healthy "${SEFI_PORT}"; then
    echo "SeFi host backend is already running on port ${SEFI_PORT} (PID ${PORT_PID})."
    echo "Cube is available on port 4100 and backend is available on port ${SEFI_PORT}."
    if [[ "${DETACH}" -eq 1 ]]; then
      echo "${PORT_PID}" > "${PID_FILE}"
    fi
    exit 0
  fi

  echo "Port ${SEFI_PORT} is already in use by PID ${PORT_PID}, but backend health check failed." >&2
  echo "Run 'npm run stop' (or free the port) and retry." >&2
  exit 1
fi

if [[ "${DETACH}" -eq 1 ]]; then
  echo "Starting SeFi backend on the host in detached mode..."
  (
    cd "${ROOT_DIR}/backend"
    if command -v setsid >/dev/null 2>&1; then
      setsid node src/server.js >"${LOG_FILE}" 2>&1 < /dev/null &
    else
      nohup node src/server.js >"${LOG_FILE}" 2>&1 < /dev/null &
    fi
    echo $! > "${PID_FILE}"
  )

  BACKEND_PID="$(cat "${PID_FILE}")"
  HEALTH_URL="http://127.0.0.1:${SEFI_PORT:-3210}/api/v1/health"
  for _ in $(seq 1 30); do
    if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
      echo "Host backend exited before becoming healthy. Recent logs:" >&2
      if [[ -f "${LOG_FILE}" ]]; then
        tail -n 100 "${LOG_FILE}" >&2 || true
      fi
      rm -f "${PID_FILE}"
      exit 1
    fi

    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      echo "SeFi host backend running with PID ${BACKEND_PID}."
      echo "Cube is available on port 4100 and backend is available on port 3210."
      echo "Backend log: ${LOG_FILE}"
      exit 0
    fi

    sleep 1
  done

  echo "Host backend did not become healthy within 30 seconds. Recent logs:" >&2
  if [[ -f "${LOG_FILE}" ]]; then
    tail -n 100 "${LOG_FILE}" >&2 || true
  fi
  rm -f "${PID_FILE}"
  exit 1
fi

BACKEND_PID=""
cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi

  rm -f "${PID_FILE}"
  docker compose down >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

echo "Starting SeFi backend on the host..."
(
  cd "${ROOT_DIR}/backend"
  npm start
) &
BACKEND_PID=$!
echo "${BACKEND_PID}" > "${PID_FILE}"
wait "${BACKEND_PID}"
