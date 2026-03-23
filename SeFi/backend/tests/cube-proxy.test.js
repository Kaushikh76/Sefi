import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCubeQueryWithRetry, isCubeContinueWait, normalizeCubeSqlPayload } from '../src/cube-proxy.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test('isCubeContinueWait detects continue wait payloads', () => {
  assert.equal(isCubeContinueWait({ error: 'Continue wait' }), true);
  assert.equal(isCubeContinueWait({ error: { message: 'continue wait' } }), true);
  assert.equal(isCubeContinueWait({ error: 'other error' }), false);
});

test('executeCubeQueryWithRetry retries Continue wait and returns payload', async () => {
  let attempts = 0;
  const result = await executeCubeQueryWithRetry({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return jsonResponse({ error: 'Continue wait' }, 200);
      }
      return jsonResponse({ data: [{ 'stats.count': 1 }] }, 200);
    },
    cubeApiUrl: 'http://cube.local/cubejs-api/v1',
    queryType: 'load',
    query: { measures: ['stats.count'] },
    headers: { Accept: 'application/json' },
    maxAttempts: 4,
    baseDelayMs: 1,
    jitterMs: 0,
    timeoutMs: 1000,
  });

  assert.equal(result.attempts, 3);
  assert.equal(result.continue_wait_count, 2);
  assert.deepEqual(result.payload, { data: [{ 'stats.count': 1 }] });
});

test('executeCubeQueryWithRetry throws timeout when Continue wait persists', async () => {
  await assert.rejects(
    () =>
      executeCubeQueryWithRetry({
        fetchImpl: async () => jsonResponse({ error: 'Continue wait' }, 200),
        cubeApiUrl: 'http://cube.local/cubejs-api/v1',
        queryType: 'sql',
        query: { measures: ['stats.count'] },
        headers: { Accept: 'application/json' },
        maxAttempts: 2,
        baseDelayMs: 1,
        jitterMs: 0,
        timeoutMs: 1000,
      }),
    (error) => {
      assert.equal(error.code, 'CUBE_CONTINUE_WAIT_TIMEOUT');
      assert.equal(error.status, 504);
      return true;
    }
  );
});

test('normalizeCubeSqlPayload extracts planner tuple and status', () => {
  const payload = {
    sql: {
      status: 'ok',
      query_type: 'regular',
      sql: ['SELECT 1 WHERE x = ?', ['a']],
    },
  };

  const normalized = normalizeCubeSqlPayload(payload);
  assert.equal(normalized.status, 'ok');
  assert.equal(normalized.query_type, 'regular');
  assert.equal(normalized.sql_text, 'SELECT 1 WHERE x = ?');
  assert.deepEqual(normalized.sql_params, ['a']);
  assert.equal(normalized.error, null);
});

test('normalizeCubeSqlPayload supports tuple-only sql payload shape', () => {
  const payload = {
    sql: ['SELECT 1', []],
  };

  const normalized = normalizeCubeSqlPayload(payload);
  assert.equal(normalized.status, 'ok');
  assert.equal(normalized.sql_text, 'SELECT 1');
  assert.deepEqual(normalized.sql_params, []);
  assert.equal(normalized.error, null);
});
