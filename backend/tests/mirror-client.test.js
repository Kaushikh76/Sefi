import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config.js';
import { MirrorNodeClient } from '../src/mirror-client.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(payload, status = 200) {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
    async json() {
      return payload;
    },
  };
}

test('fetchJson aborts timed out mirror-node requests and retries before failing', async () => {
  const config = createConfig({
    SEFI_REQUEST_TIMEOUT_MS: '1000',
    SEFI_MAX_RETRIES: '2',
    SEFI_RETRY_DELAY_MS: '1',
  });

  let attempts = 0;
  const client = new MirrorNodeClient({
    config,
    fetchImpl: async (_url, options = {}) => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 1100));

      if (options.signal?.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }

      return {
        ...jsonResponse({}),
      };
    },
  });

  await assert.rejects(() => client.fetchJson('/api/v1/contracts/0.0.1001/results/logs'), (error) => {
    assert.match(error.message, /timed out after 1000ms/);
    assert.match(error.message, /testnet\.mirrornode\.hedera\.com/);
    return true;
  });

  assert.equal(attempts, 2);
});

test('fetchJson ranks mirror pool by probe latency and uses fastest endpoint', async () => {
  const config = createConfig({
    SEFI_NETWORK: 'mainnet',
    SEFI_MIRROR_NODE_URL: 'https://slow.example',
    SEFI_MIRROR_NODE_POOL: 'https://slow.example,https://fast.example,https://fallback.example',
    SEFI_MAX_RETRIES: '1',
    SEFI_MIRROR_POOL_PROBE_TIMEOUT_MS: '1000',
  });

  const delaysByOrigin = {
    'https://slow.example': 40,
    'https://fast.example': 5,
    'https://fallback.example': 20,
  };
  const requests = [];

  const client = new MirrorNodeClient({
    config: {
      ...config,
      mirrorRestPool: config.mirrorRestPoolByNetwork.mainnet,
    },
    fetchImpl: async (url) => {
      requests.push(url);
      const origin = new URL(url).origin;
      await wait(delaysByOrigin[origin] ?? 1);
      return jsonResponse({ transactions: [] });
    },
  });

  const payload = await client.fetchJson('/api/v1/transactions?limit=1');

  assert.deepEqual(payload, { transactions: [] });
  assert.equal(client.getActiveBaseUrl(), 'https://fast.example');
  assert.equal(requests.length, 4);
  assert.match(requests[requests.length - 1], /^https:\/\/fast\.example\/api\/v1\/transactions\?limit=1/);
});

test('fetchJson preserves int64 values beyond Number.MAX_SAFE_INTEGER as strings', async () => {
  const config = createConfig({
    SEFI_NETWORK: 'mainnet',
    SEFI_MAX_RETRIES: '1',
  });

  const client = new MirrorNodeClient({
    config,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          transactions: [
            {
              transaction_id: '0.0.1-123-1',
              consensus_timestamp: '123.000000001',
              token_transfers: [
                { token_id: '0.0.6006', account: '0.0.111', amount: -9007199254740993 },
                { token_id: '0.0.6006', account: '0.0.222', amount: 9007199254740993 },
              ],
            },
          ],
        }).replaceAll('9007199254740992', '9007199254740993');
      },
    }),
  });

  const payload = await client.fetchJson('/api/v1/transactions');
  assert.equal(
    payload.transactions[0].token_transfers[0].amount,
    '-9007199254740993'
  );
  assert.equal(
    payload.transactions[0].token_transfers[1].amount,
    '9007199254740993'
  );
});
