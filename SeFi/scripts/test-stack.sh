#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://127.0.0.1:3210/api/v1"

echo "Checking SeFi backend health..."
HEALTH_JSON="$(curl -sS "${BASE_URL}/health")"
echo "${HEALTH_JSON}"

echo "Checking SeFi status (includes Cube health)..."
STATUS_JSON="$(curl -sS "${BASE_URL}/status")"
echo "${STATUS_JSON}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); console.log(JSON.stringify(parsed.cube || {}, null, 2));"

echo "Checking Cube proxy health endpoint..."
CUBE_HEALTH_JSON="$(curl -sS "${BASE_URL}/cube/health")"
echo "${CUBE_HEALTH_JSON}"

echo "Checking Cube meta proxy endpoint..."
curl -sS "${BASE_URL}/cube/meta" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); console.log(parsed.cubes ? parsed.cubes.length : 0);"

echo "Checking Cube query proxy endpoint..."
QUERY_PAYLOAD='{"query":{"measures":["stats.count"]}}'
curl -sS -X POST "${BASE_URL}/cube/query" \
  -H 'Content-Type: application/json' \
  -d "${QUERY_PAYLOAD}" \
  | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); const value = parsed?.data?.[0]?.['stats.count']; if (typeof value !== 'number') { console.error('Cube query proxy returned unexpected payload'); process.exit(1); } console.log(value);"

echo "Checking targeted sync endpoints..."
curl -sS -X POST "${BASE_URL}/index/stop" -H 'Content-Type: application/json' -d '{}' >/dev/null || true
for TARGET in contracts hts topics; do
  echo "Triggering /index/sync/${TARGET} ..."
  RESP="$(curl -sS -X POST "${BASE_URL}/index/sync/${TARGET}" -H 'Content-Type: application/json' -d '{}')"
  echo "${RESP}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (!parsed.success) { console.error('Targeted sync failed to start'); process.exit(1); } console.log(parsed.target);"
  sleep 1
  STATUS="$(curl -sS "${BASE_URL}/status")"
  echo "${STATUS}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); const phase = parsed?.sync?.phase; if (!['contracts','hts','topics','idle'].includes(String(phase))) { console.error('Unexpected sync phase', phase); process.exit(1); } console.log(phase);"
  curl -sS -X POST "${BASE_URL}/index/stop" -H 'Content-Type: application/json' -d '{}' >/dev/null || true
  sleep 1
done

echo "Checking modeling schema introspection endpoint..."
curl -sS "${BASE_URL}/modeling/sqlite/schema" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (!Array.isArray(parsed.tables)) { console.error('Modeling schema endpoint did not return tables'); process.exit(1); } console.log(parsed.tables.length);"

echo "Checking modeling preview endpoint..."
PREVIEW_JSON="$(curl -sS -X POST "${BASE_URL}/modeling/schema/preview" -H 'Content-Type: application/json' -d '{}')"
echo "${PREVIEW_JSON}" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (!parsed.preview_id) { console.error('Missing preview_id'); process.exit(1); } console.log(parsed.preview_id);"

echo "Checking agent playground context endpoint..."
curl -sS "${BASE_URL}/agents/playground/context" | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (typeof parsed.cube_count !== 'number') { console.error('Agent context missing cube_count'); process.exit(1); } console.log(parsed.cube_count);"

echo "Checking agent playground validation envelope..."
curl -sS -X POST "${BASE_URL}/agents/playground/ask" \
  -H 'Content-Type: application/json' \
  -d '{"question":"count logs","options":"bad"}' \
  | node -e "const input = require('fs').readFileSync(0, 'utf8'); const parsed = JSON.parse(input); if (parsed?.error?.code !== 'INVALID_OPTIONS') { console.error('Expected INVALID_OPTIONS from agent ask validation'); process.exit(1); } console.log(parsed.error.code);"

echo "Stack test complete."
