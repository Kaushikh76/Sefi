#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://127.0.0.1:3210/api/v1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/.env"
  set +a
fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT

api_get() {
  curl -sS -b "${COOKIE_JAR}" "$1"
}

api_post() {
  local url="$1"
  local payload="$2"
  curl -sS -b "${COOKIE_JAR}" -c "${COOKIE_JAR}" -X POST "${url}" -H 'Content-Type: application/json' -d "${payload}"
}

if [[ -n "${SEFI_DEMO_ACCESS_KEY:-}" ]]; then
  echo "Authenticating test session for write-protected endpoints..."
  AUTH_PAYLOAD="$(printf '{"access_key":"%s"}' "${SEFI_DEMO_ACCESS_KEY}")"
  AUTH_RESP="$(api_post "${BASE_URL}/auth/session" "${AUTH_PAYLOAD}")"
  echo "${AUTH_RESP}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (!parsed.success) { console.error('Session authentication failed'); process.exit(1); } console.log(parsed.access_level || 'unknown');"
fi

echo "Checking SeFi backend health..."
HEALTH_JSON="$(api_get "${BASE_URL}/health")"
echo "${HEALTH_JSON}"

echo "Checking SeFi status (includes Cube health)..."
STATUS_JSON="$(api_get "${BASE_URL}/status")"
echo "${STATUS_JSON}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); console.log(JSON.stringify(parsed.cube || {}, null, 2));"

echo "Checking Cube proxy health endpoint..."
CUBE_HEALTH_JSON="$(api_get "${BASE_URL}/cube/health")"
echo "${CUBE_HEALTH_JSON}"

echo "Checking Cube meta proxy endpoint..."
api_get "${BASE_URL}/cube/meta" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); console.log(parsed.cubes ? parsed.cubes.length : 0);"

echo "Checking Cube query proxy endpoint..."
QUERY_PAYLOAD='{"query":{"measures":["stats.count"]}}'
api_post "${BASE_URL}/cube/query" "${QUERY_PAYLOAD}" \
  | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); const dataRows = parsed?.data || parsed?.payload?.data || []; const value = dataRows?.[0]?.['stats.count']; if (typeof value !== 'number') { console.error('Cube query proxy returned unexpected payload'); process.exit(1); } console.log(value);"

echo "Checking targeted sync endpoints..."
api_post "${BASE_URL}/index/stop" '{}' >/dev/null || true
for TARGET in contracts hts topics; do
  echo "Triggering /index/sync/${TARGET} ..."
  RESP="$(api_post "${BASE_URL}/index/sync/${TARGET}" '{}')"
  echo "${RESP}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (!parsed.success) { console.error('Targeted sync failed to start'); process.exit(1); } console.log(parsed.target);"
  sleep 1
  STATUS="$(api_get "${BASE_URL}/status")"
  echo "${STATUS}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); const phase = parsed?.sync?.phase; if (!['contracts','hts','topics','idle'].includes(String(phase))) { console.error('Unexpected sync phase', phase); process.exit(1); } console.log(phase);"
  api_post "${BASE_URL}/index/stop" '{}' >/dev/null || true
  sleep 1
done

echo "Checking modeling schema introspection endpoint..."
api_get "${BASE_URL}/modeling/sqlite/schema" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (!Array.isArray(parsed.tables)) { console.error('Modeling schema endpoint did not return tables'); process.exit(1); } console.log(parsed.tables.length);"

echo "Checking modeling preview endpoint..."
PREVIEW_JSON="$(api_post "${BASE_URL}/modeling/schema/preview" '{}')"
echo "${PREVIEW_JSON}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (!parsed.preview_id) { console.error('Missing preview_id'); process.exit(1); } console.log(parsed.preview_id);"

echo "Checking agent playground context endpoint..."
api_get "${BASE_URL}/agents/playground/context" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (typeof parsed.cube_count !== 'number') { console.error('Agent context missing cube_count'); process.exit(1); } console.log(parsed.cube_count);"

echo "Checking agent playground validation envelope..."
api_post "${BASE_URL}/agents/playground/ask" '{"question":"count logs","options":"bad"}' \
  | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (parsed?.error?.code !== 'INVALID_OPTIONS') { console.error('Expected INVALID_OPTIONS from agent ask validation'); process.exit(1); } console.log(parsed.error.code);"

echo "Stack test complete."
