import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import net from 'net';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';

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

async function waitForCondition(checkFn, { timeoutMs = 25000, intervalMs = 200, errorMessage = 'Timed out waiting for condition' } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await checkFn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(errorMessage);
}

function createCubeStubServer({ port, readyDelayMs = 1200 }) {
  const server = http.createServer(async (req, res) => {
    const method = String(req.method || '').toUpperCase();
    const url = String(req.url || '');

    if (method === 'GET' && url === '/readyz') {
      await new Promise((resolve) => setTimeout(resolve, readyDelayMs));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (method === 'GET' && url === '/cubejs-api/v1/meta') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ cubes: [] }));
      return;
    }

    if (method === 'POST' && url === '/cubejs-api/v1/load') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [],
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

test('cube probe timeout is classified and degraded status still allows cube query execution', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-cube-probe-timeout-'));
  const manifestsDir = path.join(root, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });

  const backendPort = await getFreePort();
  const cubePort = await getFreePort();

  const cubeServer = await createCubeStubServer({ port: cubePort, readyDelayMs: 1200 });
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
    SEFI_CUBE_HEALTH_TIMEOUT_MS: '300',
    SEFI_CUBE_PROBE_INTERVAL_MS: '500',
    SEFI_CUBE_PROBE_FAILURE_INTERVAL_MS: '1000',
    SEFI_CUBE_PROBE_JITTER_MS: '0',
    SEFI_CUBE_PROBE_FAILURE_THRESHOLD: '100',
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

  const logEntries = [];
  let stdoutBuffer = '';
  backend.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk || '');
    while (stdoutBuffer.includes('\n')) {
      const lineBreak = stdoutBuffer.indexOf('\n');
      const line = stdoutBuffer.slice(0, lineBreak).trim();
      stdoutBuffer = stdoutBuffer.slice(lineBreak + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        logEntries.push(parsed);
      } catch {
        // ignore non-json logs
      }
    }
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

  const degradedSnapshot = await waitForCondition(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/cube/health`);
      if (!response.ok) return null;
      const payload = await response.json();
      if (String(payload?.status || '') === 'degraded' && Number(payload?.consecutive_failures || 0) >= 1) {
        return payload;
      }
    } catch {
      // retry
    }
    return null;
  }, {
    timeoutMs: 30000,
    intervalMs: 250,
    errorMessage: 'Timed out waiting for degraded cube health snapshot',
  });

  assert.equal(degradedSnapshot.status, 'degraded');

  const queryResponse = await fetch(`http://127.0.0.1:${backendPort}/api/v1/cube/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: {
        measures: ['vault_strategy_state.count'],
      },
      queryType: 'load',
    }),
  });
  const queryText = await queryResponse.text();
  assert.equal(
    queryResponse.status,
    200,
    `Expected /cube/query to succeed while cube health is degraded.\nResponse: ${queryText}\nStderr: ${stderr}`
  );

  const timeoutProbeLog = await waitForCondition(() => {
    return logEntries.find((entry) =>
      entry &&
      entry.event === 'cube_health_probe' &&
      entry.level === 'warn' &&
      entry.timed_out === true &&
      String(entry.error || '').includes('timeout after 300ms')
    );
  }, {
    timeoutMs: 15000,
    intervalMs: 150,
    errorMessage: 'Timed out waiting for cube_health_probe timeout log entry',
  });

  assert.equal(timeoutProbeLog.status, 'degraded');
});
