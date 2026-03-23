# SeFi Backend

Protocol-agnostic Hedera indexer backend for SeFi.

## Quick Start

```bash
cd SeFi/backend
npm install
npm run dev
```

The server starts at `http://localhost:3210` by default.

By default in SeFi docker-compose, indexing runs across both `mainnet` and `testnet` via `SEFI_NETWORKS=mainnet,testnet`.

## Contracts Input Path

SeFi reads manifests from:

`SeFi/contracts/manifests/*.json`

## Database Output

SeFi stores indexed data in:

`SeFi/data/sefi.db`

Cube reads a separate snapshot database at:

`SeFi/data/sefi.cube.db`

Generated model files are written to:

`SeFi/cube/model/generated/cubes/*.yml`

All model files (curated + generated) are persisted on disk under:

`SeFi/cube/model/**/*.yml`

## DB Reliability Notes

- The live DB uses host-native SQLite with `WAL` journaling and a configured `busy_timeout`.
- Cube reads a separate snapshot DB that is refreshed atomically (backup -> temp file -> rename) to reduce corruption risk under concurrent readers.
- On malformed DB detection at startup, SeFi automatically backs up the corrupted file and recreates a fresh DB.
- Schema migrations are tracked in `schema_migrations` and applied in place without requiring reindexing.
- Multi-network indexing stores network-scoped IDs (`mainnet:...`, `testnet:...`) to avoid key collisions.
- Mirror-node requests are guarded by abort timeouts via `SEFI_REQUEST_TIMEOUT_MS`.

## API Endpoints

- `GET /api/v1/health`
- `GET /api/v1/status`
- `GET /api/v1/realtime/stream?channels=index,api,activity`
- `GET /api/v1/metrics/overview`
- `GET /api/v1/contracts/progress`
- `GET /api/v1/records/recent?type=contract_logs|hts_transfers|topic_messages|erc20_transfers&limit=...`
- `GET /api/v1/status/stream`
- `POST /api/v1/index/sync`
- `POST /api/v1/index/sync/contracts`
- `POST /api/v1/index/sync/hts`
- `POST /api/v1/index/sync/topics`
- `POST /api/v1/index/listen`
- `POST /api/v1/index/stop`
- `GET /api/v1/manifests`
- `GET /api/v1/cube/health`
- `GET /api/v1/cube/meta`
- `POST /api/v1/cube/query`
- `GET /api/v1/modeling/sqlite/schema`
- `POST /api/v1/modeling/schema/preview`
- `POST /api/v1/modeling/schema/apply`
- `GET /api/v1/modeling/models/status`
- `GET /api/v1/modeling/models?scope=all|generated|curated`
- `GET /api/v1/modeling/models/content?path=generated/cubes/example.yml`
- `PUT /api/v1/modeling/models/content` (`{ path, content }`)
- `DELETE /api/v1/modeling/models/content` (`{ path }`)
- `POST /api/v1/modeling/sqlite/query`
- `POST /api/v1/modeling/ai/generate`
- `POST /api/v1/modeling/ai/approve`
- `GET /api/v1/modeling/ai/drafts/:draftId`
- `GET /api/v1/apis`
- `POST /api/v1/apis`
- `PATCH /api/v1/apis/:apiId`
- `DELETE /api/v1/apis/:apiId`
- `POST /api/v1/apis/:apiId/run`
- `POST /api/v1/endpoints/:slug`
- `GET /api/v1/agents/playground/context`
- `POST /api/v1/agents/playground/ask`
- `POST /api/v1/agents/playground/execute`
- `GET /api/v1/agents/templates`
- `GET /api/v1/agents`
- `POST /api/v1/agents`
- `GET /api/v1/agents/:id`
- `PATCH /api/v1/agents/:id`
- `DELETE /api/v1/agents/:id`
- `POST /api/v1/agents/:id/start`
- `POST /api/v1/agents/:id/stop`
- `GET /api/v1/agents/:id/activity`
- `GET /api/v1/agents/:id/runs`
- `POST /api/v1/agents/:id/brainstorm`
- `POST /api/v1/agents/:id/publish/test`

## Security and Agent Env

- `SEFI_API_TOKEN` (optional): enables token-gated `/api/v1/*` routes except `/health`
- `SEFI_ALLOWED_ORIGINS`: CSV allowlist for CORS
- `SEFI_CUBE_HEALTH_TIMEOUT_MS`: timeout for cube readiness probe
- `SEFI_CUBE_HEALTH_CACHE_TTL_MS`: cache TTL for cube readiness probe
- `SEFI_CUBE_DB_PATH`: file path for the Cube snapshot database
- `SEFI_REQUEST_TIMEOUT_MS`: mirror-node HTTP timeout before abort/retry
- `OPENAI_API_KEY`: required for agent planner
- `OPENAI_MODEL_FAST` / `OPENAI_MODEL_STRONG`: tiered models for planner calls
- `SEFI_AGENT_AUTO_EXECUTE_DEFAULT`: default auto-execute behavior
- `SEFI_AGENT_SQL_FALLBACK_DEFAULT`: default SQL fallback policy
- `SEFI_AGENT_AUTONOMOUS_NETWORKS`: CSV list for autonomous agent execution policy (v1 default `testnet`)
- `SEFI_ELIZA_BASE_URL`: Eliza sidecar base URL (default `http://127.0.0.1:3001`)
- `SEFI_ELIZA_API_KEY`: optional API key for Eliza sidecar proxy calls

- `sync` is one-time backfill and returns to `idle` when complete.
- `status.sync.phase` exposes current phase (`contracts|hts|topics|idle`) with progress metadata.
- `listen` is near-real-time polling mode until stopped.
- `POST /api/v1/cube/query` supports `queryType=load|sql`, retries Cube `Continue wait`, and returns normalized SQL planner metadata in SQL mode.
- Realtime transport is SSE-only via `GET /api/v1/realtime/stream`.
- Studio AI generation is draft-first. Drafts are not saved to disk until `POST /api/v1/modeling/ai/approve`.
- API Builder endpoints (`/api/v1/apis*`, `/api/v1/endpoints/:slug`) execute typed, templated Cube queries only (no raw passthrough).

## Run Tests

```bash
cd SeFi/backend
npm test
```
