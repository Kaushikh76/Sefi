# SeFi

SeFi indexes Hedera blockchain protocol data into a host-native SQLite database and exposes it for analytics and AI consumption through a separate Cube snapshot database.

## Layout

- `backend/` -> indexer service and API
- `contracts/manifests/` -> open manifest drop path for protocols
- `data/` -> generated SQLite databases (`sefi.db` live writer, `sefi.cube.db` Cube snapshot)
- `cube/` -> Cube semantic layer for `SeFi/data/sefi.cube.db`
- `frontend/` -> Next.js + shadcn dashboard

## Protocol-Agnostic Manifest Path

`SeFi/contracts/manifests/*.json`

Any protocol can add manifests here; SeFi is not Bonzo-specific.

## Bonzo Contract Import

Import all Bonzo contracts from `Bonzo/src/contracts.js` into SeFi manifest:

```bash
cd SeFi
npm run manifest:import:bonzo
```

This writes `SeFi/contracts/manifests/bonzo.mainnet.manifest.json`.

The Bonzo manifest is mainnet scoped, so run SeFi with:

```bash
cd SeFi
SEFI_NETWORK=mainnet npm start
```

## Host Backend + Cube (Single Command)

Start the SeFi backend on the host and Cube in Docker:

```bash
cd SeFi
npm start
```

Start both services in detached mode:

```bash
cd SeFi
npm run start:detached
```

Keep a fully containerized fallback available when you explicitly want it:

```bash
cd SeFi
npm run start:containerized
```

Verify the coupled stack:

```bash
cd SeFi
npm run test:stack
```

Notes:

- `npm start` prepares `SeFi/data/sefi.db`, refreshes `SeFi/data/sefi.cube.db`, starts Cube in Docker, and then runs the backend on the host.
- The live writer DB stays in host RAM and on the host filesystem; Cube reads only the snapshot DB so large SQLite workloads no longer depend on Docker Desktop VM memory.
- `SEFI_DB_PATH` still controls the live DB path and the new `SEFI_CUBE_DB_PATH` controls the Cube snapshot path.
- `npm run start:containerized` keeps the old all-Docker topology available as an explicit fallback.
- default stack indexes both networks (`SEFI_NETWORKS=mainnet,testnet`) while preserving `SEFI_NETWORK` as the primary/default network.
- Cube snapshots are written atomically to reduce corruption risk while Cube reads during indexing.
- `npm run test:stack` validates backend health, Cube proxy health, Cube metadata, and a real Cube query (`stats.count`).
- backend health uses Cube `/readyz` with timeout + short cache to prevent blocking status calls.
- modeling APIs are exposed under `/api/v1/modeling/*` and write generated files into `SeFi/cube/model/generated/cubes`.
- semantic agent playground APIs are exposed under `/api/v1/agents/playground/*` and require `OPENAI_API_KEY`.
- managed Hedera + ElizaOS agent APIs are exposed under `/api/v1/agents/*`.
- optional Eliza sidecar container is available via compose profile `agents` on `http://localhost:3001`.
- optional API token mode is available with `SEFI_API_TOKEN` (token accepted via `x-sefi-api-token` or `Authorization: Bearer`).
- targeted one-time index endpoints are available for operators: `/api/v1/index/sync/contracts`, `/api/v1/index/sync/hts`, `/api/v1/index/sync/topics`.
- `listen` mode is near-real-time polling, not a push stream from the mirror node.

## Storage Troubleshooting

If disk usage jumps while running SeFi, most of the usage is typically from Docker Desktop storage and build cache rather than the host SQLite files in `SeFi/data`.

Useful checks:

```bash
cd SeFi
npm run docker:df
du -sh ./data ./frontend/.next ./frontend/node_modules
```

Build cache cleanup:

```bash
cd SeFi
npm run docker:prune:build-cache
```

Notes:

- `npm start` avoids rebuild by default to reduce cache churn.
- `npm run start:build` keeps the same host-backend topology and only rebuilds Docker services when relevant.
- Docker Desktop stores image/cache data inside `~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw` on macOS.
