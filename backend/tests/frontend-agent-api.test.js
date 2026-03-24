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

async function waitForHttpOk(url, timeoutMs = 25000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createCubeStubServer({ port }) {
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
          cubes: [
            {
              name: 'vault_strategy_state',
              title: 'Vault Strategy State',
              measures: [{ name: 'vault_strategy_state.count', title: 'Count', type: 'count' }],
              dimensions: [
                { name: 'vault_strategy_state.vault_address', title: 'Vault Address', type: 'string' },
                { name: 'vault_strategy_state.tvl_usd', title: 'TVL USD', type: 'number' },
              ],
            },
          ],
        })
      );
      return;
    }

    if (method === 'POST' && url === '/cubejs-api/v1/load') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [{ 'vault_strategy_state.count': 1 }],
          annotation: {},
          lastRefreshTime: new Date().toISOString(),
        })
      );
      return;
    }

    if (method === 'POST' && url === '/cubejs-api/v1/sql') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sql: ['SELECT 1', []] }));
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

test('frontend agent + derived/cube API contract endpoints work end-to-end', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-frontend-agent-api-'));
  const manifestsDir = path.join(root, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });

  const backendPort = await getFreePort();
  const cubePort = await getFreePort();

  const cubeServer = await createCubeStubServer({ port: cubePort });
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
    OPENAI_API_KEY: 'sk-test',
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

  await waitForHttpOk(`http://127.0.0.1:${backendPort}/api/v1/health`, 30000);
  await waitForHttpOk(`http://127.0.0.1:${backendPort}/api/v1/cube/health`, 30000);

  const db = new Database(env.SEFI_DB_PATH);
  db.prepare(
    `INSERT OR REPLACE INTO vault_strategy_state (
      vault_address, vault_name, strategy_address, pool_address, asset_pair,
      current_position_id, token0_symbol, token1_symbol, current_tick,
      active_lower_tick, active_upper_tick, in_range, distance_to_lower,
      distance_to_upper, idle_ratio, deployed_ratio, idle_usd, deployed_usd,
      tvl_usd, share_price, rebalance_count_24h, last_rebalance_at, state_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    '0xvault1',
    'Vault Alpha',
    '0xstrategy1',
    '0xpool1',
    'USDC/HBAR',
    'pos-1',
    'USDC',
    'HBAR',
    100,
    80,
    120,
    1,
    20,
    20,
    0.25,
    0.75,
    2500,
    7500,
    10000,
    1.02,
    2,
    '2026-03-23T10:00:00.000Z',
    '2026-03-23T10:15:00.000Z',
    '2026-03-23T10:15:00.000Z'
  );

  db.prepare(
    `INSERT OR REPLACE INTO clmm_positions (
      position_id, pool_address, vault_address, strategy_address, owner_address,
      token0_symbol, token1_symbol, tick_lower, tick_upper, liquidity,
      amount0, amount1, fees_owed0, fees_owed1, is_active,
      minted_at, last_updated_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'pos-1',
    '0xpool1',
    '0xvault1',
    '0xstrategy1',
    '0xowner1',
    'USDC',
    'HBAR',
    80,
    120,
    1000,
    3000,
    100,
    1,
    2,
    1,
    '2026-03-23T09:00:00.000Z',
    '2026-03-23T10:10:00.000Z',
    '2026-03-23T10:10:00.000Z'
  );

  db.prepare(
    `INSERT OR REPLACE INTO vault_actions_decoded (
      action_id, vault_address, strategy_address, pool_address, tx_hash,
      actor_address, action_type, position_id, tick_lower, tick_upper,
      amount0, amount1, shares, value_usd, block_number, action_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'act-1',
    '0xvault1',
    '0xstrategy1',
    '0xpool1',
    '0xtx1',
    '0xactor1',
    'rebalance',
    'pos-1',
    80,
    120,
    10,
    20,
    1,
    100,
    12345,
    '2026-03-23T10:14:00.000Z',
    '2026-03-23T10:14:00.000Z'
  );

  db.prepare(
    `INSERT OR REPLACE INTO clmm_pool_snapshots (
      snapshot_id, pool_address, dex_name, token0_symbol, token1_symbol,
      fee_tier_bps, current_tick, sqrt_price_x96, spot_price, active_liquidity,
      tvl_usd, block_number, snapshot_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'snap-1',
    '0xpool1',
    'bonzo',
    'USDC',
    'HBAR',
    30,
    100,
    '123',
    1.1,
    5000,
    10000,
    12345,
    '2026-03-23T10:13:00.000Z',
    '2026-03-23T10:13:00.000Z'
  );

  db.prepare(
    `INSERT OR REPLACE INTO price_volatility_snapshots (
      snapshot_id, market_key, base_symbol, quote_symbol, source, interval_label,
      price, return_1h, return_6h, return_24h,
      realized_vol_1h, realized_vol_6h, realized_vol_24h,
      snapshot_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'vol-1',
    'USDC/HBAR',
    'USDC',
    'HBAR',
    'bonzo_market',
    '1h',
    1.1,
    0.01,
    0.02,
    0.03,
    0.12,
    0.2,
    0.3,
    '2026-03-23T10:13:00.000Z',
    '2026-03-23T10:13:00.000Z'
  );

  db.close();

  const catalogRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/frontend/catalog`);
  assert.equal(catalogRes.status, 200, `catalog failed: ${stderr}`);
  const catalogPayload = await catalogRes.json();
  assert.ok(Array.isArray(catalogPayload?.modes?.pipeline_lifecycle));
  assert.ok(catalogPayload?.modes?.pipeline_lifecycle.includes('rebuild'));
  assert.ok(Array.isArray(catalogPayload?.modes?.agent_operations));
  assert.ok(catalogPayload?.modes?.agent_operations.includes('query'));

  const vaultsRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/frontend/vaults?limit=3&sort=tvl_usd`);
  assert.equal(vaultsRes.status, 200, `vaults failed: ${stderr}`);
  const vaultsPayload = await vaultsRes.json();
  assert.equal(vaultsPayload.count >= 1, true);

  const overviewRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/frontend/vaults/0xvault1/overview`);
  assert.equal(overviewRes.status, 200, `overview failed: ${stderr}`);
  const overviewPayload = await overviewRes.json();
  assert.equal(overviewPayload?.vault?.vault_name, 'Vault Alpha');

  const positionsRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/frontend/vaults/0xvault1/positions?limit=10`);
  assert.equal(positionsRes.status, 200, `positions failed: ${stderr}`);
  const positionsPayload = await positionsRes.json();
  assert.equal(positionsPayload.count >= 1, true);

  const actionsRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/frontend/vaults/0xvault1/actions?days=7&limit=10`);
  assert.equal(actionsRes.status, 200, `actions failed: ${stderr}`);
  const actionsPayload = await actionsRes.json();
  assert.equal(actionsPayload.count >= 1, true);

  const riskRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/frontend/vaults/0xvault1/risk`);
  assert.equal(riskRes.status, 200, `risk failed: ${stderr}`);
  const riskPayload = await riskRes.json();
  assert.equal(typeof riskPayload.in_range, 'boolean');

  const bootstrapRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/agents/frontend/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal([200, 201].includes(bootstrapRes.status), true, `bootstrap failed: ${stderr}`);
  const bootstrapPayload = await bootstrapRes.json();
  assert.equal(Boolean(bootstrapPayload?.agent?.id), true);

  const createSessionRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/agents/chat/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Frontend test session' }),
  });
  assert.equal(createSessionRes.status, 201, `create session failed: ${stderr}`);
  const sessionPayload = await createSessionRes.json();
  assert.equal(Boolean(sessionPayload?.id), true);
  const sessionId = sessionPayload.id;

  const diagnosticsRes = await fetch(
    `http://127.0.0.1:${backendPort}/api/v1/agents/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'show diagnostics',
        intent: 'diagnostics',
      }),
    }
  );
  assert.equal(diagnosticsRes.status, 200, `diagnostics chat failed: ${stderr}`);
  const diagnosticsPayload = await diagnosticsRes.json();
  assert.equal(diagnosticsPayload?.turn?.mode, 'diagnostics');

  const rebuildChallengeRes = await fetch(
    `http://127.0.0.1:${backendPort}/api/v1/agents/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'rebuild clmm pool snapshots',
        intent: 'pipeline_ops',
        tool_input: {
          action: 'rebuild',
          pipelines: ['clmm_pool_snapshots'],
          limit: 100,
          max_passes: 5,
        },
      }),
    }
  );
  assert.equal(rebuildChallengeRes.status, 200, `rebuild challenge failed: ${stderr}`);
  const rebuildChallengePayload = await rebuildChallengeRes.json();
  assert.equal(rebuildChallengePayload?.turn?.result?.requires_confirmation, true);
  const confirmationToken = rebuildChallengePayload?.turn?.result?.confirmation?.confirmation_token;
  assert.equal(Boolean(confirmationToken), true);

  const rebuildConfirmRes = await fetch(
    `http://127.0.0.1:${backendPort}/api/v1/agents/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'rebuild clmm pool snapshots',
        intent: 'pipeline_ops',
        confirm_token: confirmationToken,
        tool_input: {
          action: 'rebuild',
          pipelines: ['clmm_pool_snapshots'],
          limit: 100,
          max_passes: 5,
        },
      }),
    }
  );
  assert.equal(rebuildConfirmRes.status, 200, `rebuild confirmation failed: ${stderr}`);
  const rebuildConfirmPayload = await rebuildConfirmRes.json();
  assert.equal(Boolean(rebuildConfirmPayload?.turn?.result?.started_at), true);

  const messagesRes = await fetch(
    `http://127.0.0.1:${backendPort}/api/v1/agents/chat/sessions/${encodeURIComponent(sessionId)}/messages?limit=50`
  );
  assert.equal(messagesRes.status, 200, `list messages failed: ${stderr}`);
  const messagesPayload = await messagesRes.json();
  assert.equal(messagesPayload.count >= 4, true);

  const completionRes = await fetch(`http://127.0.0.1:${backendPort}/api/v1/agents/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'show diagnostics',
      intent: 'diagnostics',
    }),
  });
  assert.equal(completionRes.status, 200, `completion failed: ${stderr}`);
  const completionPayload = await completionRes.json();
  assert.equal(completionPayload.mode, 'diagnostics');

  const streamRes = await fetch(
    `http://127.0.0.1:${backendPort}/api/v1/agents/chat/sessions/${encodeURIComponent(sessionId)}/stream?recent=true`
  );
  assert.equal(streamRes.status, 200, `stream failed: ${stderr}`);
  assert.equal((streamRes.headers.get('content-type') || '').includes('text/event-stream'), true);
  await streamRes.body?.cancel();
});
