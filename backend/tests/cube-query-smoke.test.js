import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import net from 'net';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttpOk(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForCubeReady(backendPort, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/cube/health`);
      if (response.ok) {
        const payload = await response.json();
        if (String(payload?.status || '') === 'up') {
          return;
        }
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for backend cube health to become up');
}

function createCubeStubServer({ port, loadCalls }) {
  const server = http.createServer(async (req, res) => {
    const method = String(req.method || '').toUpperCase();
    const url = String(req.url || '');

    if (method === 'GET' && url === '/readyz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (method === 'GET' && url === '/cubejs-api/v1/meta') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          cubes: [],
        })
      );
      return;
    }

    if (method === 'POST' && url === '/cubejs-api/v1/load') {
      const bodyChunks = [];
      for await (const chunk of req) {
        bodyChunks.push(chunk);
      }
      const bodyText = Buffer.concat(bodyChunks).toString('utf8');
      let payload = {};
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = {};
      }

      loadCalls.push(payload.query || {});

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          query: payload.query || {},
          data: [],
          annotation: {},
          lastRefreshTime: new Date().toISOString(),
        })
      );
      return;
    }

    if (method === 'POST' && url === '/cubejs-api/v1/sql') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          sql: ['SELECT 1', []],
        })
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('smoke executes six CLMM/vault queries via /api/v1/cube/query', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-cube-smoke-'));
  const manifestsDir = path.join(root, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });

  const backendPort = await getFreePort();
  const cubePort = await getFreePort();
  const loadCalls = [];

  const cubeServer = await createCubeStubServer({ port: cubePort, loadCalls });
  t.after(async () => {
    await new Promise((resolve) => cubeServer.close(() => resolve()));
  });

  const env = {
    ...process.env,
    SEFI_PORT: String(backendPort),
    SEFI_DB_PATH: path.join(root, 'sefi.db'),
    SEFI_CUBE_DB_PATH: path.join(root, 'sefi.cube.db'),
    SEFI_MANIFESTS_DIR: manifestsDir,
    SEFI_DERIVED_ENABLED: 'true',
    SEFI_CUBE_API_URL: `http://127.0.0.1:${cubePort}/cubejs-api/v1`,
    SEFI_CUBE_HEALTH_TIMEOUT_MS: '1000',
    SEFI_CUBE_PROBE_INTERVAL_MS: '500',
    SEFI_CUBE_PROBE_FAILURE_INTERVAL_MS: '1000',
    SEFI_CUBE_PROBE_JITTER_MS: '0',
    SEFI_REQUIRE_AUTH: 'false',
    SEFI_DEMO_MODE: 'false',
  };

  const backend = spawn('node', ['src/server.js'], {
    cwd: path.resolve(process.cwd()),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  backend.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  t.after(async () => {
    if (!backend.killed) {
      backend.kill('SIGTERM');
    }
    await new Promise((resolve) => {
      backend.once('exit', () => resolve());
      setTimeout(() => resolve(), 3000);
    });
  });

  await waitForHttpOk(`http://127.0.0.1:${backendPort}/api/v1/health`, 25000);
  await waitForCubeReady(backendPort, 25000);

  const db = new Database(env.SEFI_DB_PATH);
  db.prepare(
    `INSERT OR REPLACE INTO clmm_pool_snapshots (
      snapshot_id,
      pool_address,
      dex_name,
      token0_symbol,
      token1_symbol,
      tvl_usd,
      snapshot_at,
      indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'seed-snapshot-1',
    '0xpool',
    'bonzo_clmm',
    'USDC',
    'HBAR',
    12345.67,
    '2025-11-06T22:29:54.501Z',
    '2025-11-06T22:30:00.000Z'
  );
  db.close();

  const queries = [
    {
      dimensions: [
        'clmm_pool_snapshots.pool_address',
        'clmm_pool_snapshots.dex_name',
        'clmm_pool_snapshots.token0_symbol',
        'clmm_pool_snapshots.token1_symbol',
        'clmm_pool_snapshots.current_tick',
        'clmm_pool_snapshots.spot_price',
        'clmm_pool_snapshots.tvl_usd',
      ],
      timeDimensions: [
        {
          dimension: 'clmm_pool_snapshots.snapshot_at',
          dateRange: 'Last 24 hours',
        },
      ],
      order: {
        'clmm_pool_snapshots.snapshot_at': 'desc',
      },
      limit: 10,
    },
    {
      measures: ['clmm_positions.active_positions', 'clmm_positions.total_liquidity'],
      dimensions: [
        'clmm_positions.vault_address',
        'clmm_positions.pool_address',
        'clmm_positions.position_id',
        'clmm_positions.tick_lower',
        'clmm_positions.tick_upper',
        'clmm_positions.range_width',
      ],
      filters: [
        {
          member: 'clmm_positions.is_active',
          operator: 'equals',
          values: ['true'],
        },
      ],
      order: {
        'clmm_positions.last_updated_at': 'desc',
      },
      limit: 20,
    },
    {
      dimensions: [
        'vault_strategy_state.vault_name',
        'vault_strategy_state.vault_address',
        'vault_strategy_state.asset_pair',
        'vault_strategy_state.current_tick',
        'vault_strategy_state.active_lower_tick',
        'vault_strategy_state.active_upper_tick',
        'vault_strategy_state.in_range',
        'vault_strategy_state.idle_ratio',
        'vault_strategy_state.deployed_ratio',
        'vault_strategy_state.tvl_usd',
      ],
      order: {
        'vault_strategy_state.state_at': 'desc',
      },
      limit: 25,
    },
    {
      measures: [
        'vault_actions_decoded.count',
        'vault_actions_decoded.unique_tx_count',
        'vault_actions_decoded.total_value_usd',
      ],
      dimensions: ['vault_actions_decoded.vault_address', 'vault_actions_decoded.action_type'],
      timeDimensions: [
        {
          dimension: 'vault_actions_decoded.action_at',
          dateRange: 'Last 7 days',
          granularity: 'day',
        },
      ],
      order: {
        'vault_actions_decoded.action_at': 'desc',
      },
      limit: 100,
    },
    {
      dimensions: [
        'price_volatility_snapshots.market_key',
        'price_volatility_snapshots.base_symbol',
        'price_volatility_snapshots.quote_symbol',
        'price_volatility_snapshots.price',
        'price_volatility_snapshots.realized_vol_1h',
        'price_volatility_snapshots.realized_vol_6h',
        'price_volatility_snapshots.realized_vol_24h',
      ],
      timeDimensions: [
        {
          dimension: 'price_volatility_snapshots.snapshot_at',
          dateRange: 'Last 48 hours',
        },
      ],
      order: {
        'price_volatility_snapshots.snapshot_at': 'desc',
      },
      limit: 50,
    },
    {
      dimensions: [
        'clmm_agent_state.vault_name',
        'clmm_agent_state.asset_pair',
        'clmm_agent_state.in_range',
        'clmm_agent_state.nearest_boundary_distance',
        'clmm_agent_state.realized_vol_6h',
        'clmm_agent_state.risk_regime',
        'clmm_agent_state.suggested_action',
        'clmm_agent_state.confidence_score',
        'clmm_agent_state.reason_summary',
      ],
      filters: [
        {
          member: 'clmm_agent_state.suggested_action',
          operator: 'notEquals',
          values: ['hold'],
        },
      ],
      order: {
        'clmm_agent_state.state_at': 'desc',
      },
      limit: 25,
    },
  ];

  for (const query of queries) {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/cube/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
      }),
    });

    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.query_type, 'load');
    assert.equal(Array.isArray(payload.payload?.data), true);
  }

  assert.equal(loadCalls.length, 6, stderr || 'Expected 6 load calls routed to Cube service');
  const firstRange = loadCalls[0]?.timeDimensions?.[0]?.dateRange;
  assert.equal(Array.isArray(firstRange), true, 'Expected relative date range to be anchored to table max timestamp');
  assert.equal(firstRange[1], '2025-11-06T22:29:54.501Z');
});
