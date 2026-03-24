# SeFi Backend

Protocol-agnostic Hedera indexer backend for SeFi.

## Quick Start

```bash
cd backend
npm install
npm run dev
```

Server default: `http://localhost:3210`

## Paths

- Manifests input: `contracts/manifests/*.json`
- Live DB: `data/sefi.db`
- Cube snapshot DB: `data/sefi.cube.db`
- Generated Cube models: `cube/model/generated/cubes/*.yml`

## Key API Groups

- Health/status/auth: `/api/v1/health`, `/api/v1/status`, `/api/v1/auth/*`
- Indexing ops: `/api/v1/index/*`
- Cube proxy: `/api/v1/cube/*`
- Modeling: `/api/v1/modeling/*`
- Derived pipelines/sources: `/api/v1/derived/*`
- Agent APIs: `/api/v1/agents/*`

## Env Highlights

- `SEFI_PORT`, `SEFI_NETWORK`, `SEFI_NETWORKS`
- `SEFI_DB_PATH`, `SEFI_CUBE_DB_PATH`
- `SEFI_API_TOKEN`, `SEFI_DEMO_MODE`, `SEFI_DEMO_ACCESS_KEY`
- `SEFI_CUBE_API_URL`, `SEFI_CUBE_API_TOKEN`, `SEFI_CUBE_HEALTH_TIMEOUT_MS`
- `OPENAI_API_KEY`, `OPENAI_MODEL_FAST`, `OPENAI_MODEL_STRONG`

## Tests

```bash
cd backend
npm test
```

## More Detail

See the root architecture and flow guide: [../README.md](../README.md)
