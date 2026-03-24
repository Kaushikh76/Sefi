import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config.js';

test('createConfig defaults to testnet', () => {
  const config = createConfig({});
  assert.equal(config.network, 'testnet');
  assert.deepEqual(config.networks, ['testnet']);
  assert.equal(config.mirrorRestBaseUrl, 'https://testnet.mirrornode.hedera.com');
});

test('createConfig falls back for unsupported network', () => {
  const config = createConfig({ SEFI_NETWORK: 'invalid-network' });
  assert.equal(config.network, 'testnet');
});

test('createConfig enforces page limit bounds', () => {
  const low = createConfig({ SEFI_PAGE_LIMIT: '0' });
  const high = createConfig({ SEFI_PAGE_LIMIT: '10000' });
  const ok = createConfig({ SEFI_PAGE_LIMIT: '25' });

  assert.equal(low.pageLimit, 100);
  assert.equal(high.pageLimit, 100);
  assert.equal(ok.pageLimit, 25);
});

test('createConfig resolves mirror endpoint by network', () => {
  const mainnet = createConfig({ SEFI_NETWORK: 'mainnet' });
  const previewnet = createConfig({ SEFI_NETWORK: 'previewnet' });

  assert.equal(mainnet.mirrorRestBaseUrl, 'https://mainnet.mirrornode.hedera.com');
  assert.equal(previewnet.mirrorRestBaseUrl, 'https://previewnet.mirrornode.hedera.com');
});

test('createConfig parses multi-network indexing list', () => {
  const config = createConfig({ SEFI_NETWORK: 'testnet', SEFI_NETWORKS: 'mainnet,testnet,mainnet' });
  assert.equal(config.network, 'testnet');
  assert.deepEqual(config.networks, ['mainnet', 'testnet']);
  assert.equal(config.mirrorRestByNetwork.mainnet, 'https://mainnet.mirrornode.hedera.com');
  assert.equal(config.mirrorRestByNetwork.testnet, 'https://testnet.mirrornode.hedera.com');
  assert.deepEqual(config.mirrorRestPoolByNetwork.mainnet, [
    'https://mainnet.mirrornode.hedera.com',
    'https://hedera-mirror.linkpool.pro',
    'https://mainnet-public.mirrornode.hedera.com',
  ]);
  assert.deepEqual(config.mirrorRestPoolByNetwork.testnet, ['https://testnet.mirrornode.hedera.com']);
});

test('createConfig applies explicit mirror pool override for the primary network', () => {
  const config = createConfig({
    SEFI_NETWORK: 'mainnet',
    SEFI_MIRROR_NODE_URL: 'https://mainnet-public.mirrornode.hedera.com',
    SEFI_MIRROR_NODE_POOL: 'https://mainnet.mirrornode.hedera.com,https://hedera-mirror.linkpool.pro',
  });

  assert.equal(config.mirrorRestBaseUrl, 'https://mainnet-public.mirrornode.hedera.com');
  assert.deepEqual(config.mirrorRestPoolByNetwork.mainnet, [
    'https://mainnet-public.mirrornode.hedera.com',
    'https://mainnet.mirrornode.hedera.com',
    'https://hedera-mirror.linkpool.pro',
  ]);
});

test('createConfig sets cube defaults', () => {
  const config = createConfig({});
  assert.equal(config.cubeApiUrl, 'http://127.0.0.1:4100/cubejs-api/v1');
  assert.equal(config.cubeApiToken, '');
  assert.match(config.cubeDbPath, /data\/sefi\.cube\.db$/);
  assert.equal(config.cubeHealthTimeoutMs, 10000);
  assert.equal(config.cubeHealthCacheTtlMs, 1500);
  assert.equal(config.mirrorRequestTimeoutMs, 15000);
  assert.match(config.cubeModelDir, /cube\/model$/);
  assert.deepEqual(config.allowedOrigins, ['*']);
  assert.equal(config.agentAutoExecuteDefault, true);
  assert.equal(config.agentSqlFallbackDefault, false);
  assert.deepEqual(config.agentAutonomousNetworks, ['testnet']);
  assert.equal(config.elizaBaseUrl, 'http://127.0.0.1:3001');
  assert.equal(config.elizaApiKey, '');
  assert.equal(config.saveIntervalMs, 30000);
  assert.equal(config.saveDebounceMs, 5000);
  assert.equal(config.derivedEnabled, true);
  assert.equal(config.derivedBatchSize, 2000);
  assert.equal(config.derivedReconcileCron, '0 2 * * *');
  assert.equal(config.bonzoApiBaseUrl, 'https://data.bonzo.finance/');
  assert.equal(config.externalSourceTimeoutMs, 8000);
  assert.equal(config.externalSourceMaxRetries, 3);
  assert.equal(config.mirrorPoolProbeEnabled, true);
  assert.equal(config.mirrorPoolProbeTimeoutMs, 1500);
  assert.equal(config.mirrorPoolProbePath, '/api/v1/network/nodes?limit=1');
});

test('createConfig parses security and agent env overrides', () => {
  const config = createConfig({
    SEFI_API_TOKEN: 'secret-token',
    SEFI_ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL_FAST: 'fast-model',
    OPENAI_MODEL_STRONG: 'strong-model',
    SEFI_CUBE_HEALTH_TIMEOUT_MS: '5000',
    SEFI_CUBE_HEALTH_CACHE_TTL_MS: '2500',
    SEFI_REQUEST_TIMEOUT_MS: '7000',
    SEFI_MIRROR_POOL_PROBE_ENABLED: 'false',
    SEFI_MIRROR_POOL_PROBE_TIMEOUT_MS: '2200',
    SEFI_MIRROR_POOL_PROBE_PATH: '/api/v1/transactions?limit=1',
    SEFI_AGENT_AUTO_EXECUTE_DEFAULT: 'false',
    SEFI_AGENT_SQL_FALLBACK_DEFAULT: 'true',
    SEFI_AGENT_AUTONOMOUS_NETWORKS: 'testnet,previewnet',
    SEFI_ELIZA_BASE_URL: 'http://localhost:3333',
    SEFI_ELIZA_API_KEY: 'eliza-key',
    SEFI_SAVE_INTERVAL_MS: '60000',
    SEFI_SAVE_DEBOUNCE_MS: '9000',
    SEFI_DERIVED_ENABLED: 'false',
    SEFI_DERIVED_BATCH_SIZE: '1500',
    SEFI_DERIVED_RECONCILE_CRON: '15 1 * * *',
    SEFI_BONZO_API_BASE_URL: 'https://mainnet-data-staging.bonzo.finance/',
    SEFI_EXTERNAL_SOURCE_TIMEOUT_MS: '12000',
    SEFI_EXTERNAL_SOURCE_MAX_RETRIES: '5',
    SEFI_REQUIRE_AUTH: 'true',
    SEFI_DEMO_ACCESS_KEY: 'demo-secret',
  });

  assert.equal(config.apiToken, 'secret-token');
  assert.deepEqual(config.allowedOrigins, ['https://app.example.com', 'https://admin.example.com']);
  assert.equal(config.openaiApiKey, 'sk-test');
  assert.equal(config.openaiModelFast, 'fast-model');
  assert.equal(config.openaiModelStrong, 'strong-model');
  assert.equal(config.cubeHealthTimeoutMs, 5000);
  assert.equal(config.cubeHealthCacheTtlMs, 2500);
  assert.equal(config.mirrorRequestTimeoutMs, 7000);
  assert.equal(config.mirrorPoolProbeEnabled, false);
  assert.equal(config.mirrorPoolProbeTimeoutMs, 2200);
  assert.equal(config.mirrorPoolProbePath, '/api/v1/transactions?limit=1');
  assert.equal(config.agentAutoExecuteDefault, false);
  assert.equal(config.agentSqlFallbackDefault, true);
  assert.deepEqual(config.agentAutonomousNetworks, ['testnet', 'previewnet']);
  assert.equal(config.elizaBaseUrl, 'http://localhost:3333');
  assert.equal(config.elizaApiKey, 'eliza-key');
  assert.equal(config.saveIntervalMs, 60000);
  assert.equal(config.saveDebounceMs, 9000);
  assert.equal(config.derivedEnabled, false);
  assert.equal(config.derivedBatchSize, 1500);
  assert.equal(config.derivedReconcileCron, '15 1 * * *');
  assert.equal(config.bonzoApiBaseUrl, 'https://mainnet-data-staging.bonzo.finance/');
  assert.equal(config.externalSourceTimeoutMs, 12000);
  assert.equal(config.externalSourceMaxRetries, 5);
  assert.equal(config.requireAuth, true);
  assert.equal(config.demoAccessKey, 'demo-secret');
});

test('createConfig rejects strict auth without credentials', () => {
  assert.throws(
    () => createConfig({ SEFI_REQUIRE_AUTH: 'true' }),
    /SEFI_REQUIRE_AUTH=true requires SEFI_API_TOKEN or SEFI_DEMO_ACCESS_KEY/
  );
});
