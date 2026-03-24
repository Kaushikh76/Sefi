import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const SUPPORTED_NETWORKS = {
  mainnet: {
    mirrorRest: 'https://mainnet.mirrornode.hedera.com',
    mirrorRestPool: [
      'https://mainnet.mirrornode.hedera.com',
      'https://hedera-mirror.linkpool.pro',
      'https://mainnet-public.mirrornode.hedera.com',
    ],
  },
  testnet: {
    mirrorRest: 'https://testnet.mirrornode.hedera.com',
    mirrorRestPool: ['https://testnet.mirrornode.hedera.com'],
  },
  previewnet: {
    mirrorRest: 'https://previewnet.mirrornode.hedera.com',
    mirrorRestPool: ['https://previewnet.mirrornode.hedera.com'],
  },
};

export const DEFAULT_NETWORK = 'testnet';

function normalizeNetwork(network) {
  if (!network) return DEFAULT_NETWORK;
  const normalized = String(network).trim().toLowerCase();
  if (!(normalized in SUPPORTED_NETWORKS)) {
    return DEFAULT_NETWORK;
  }
  return normalized;
}

function normalizeNetworks(networksValue, fallbackNetwork) {
  const rawItems = Array.isArray(networksValue)
    ? networksValue
    : String(networksValue || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  const normalized = [];
  for (const raw of rawItems) {
    const candidate = normalizeNetwork(raw);
    if (!normalized.includes(candidate)) {
      normalized.push(candidate);
    }
  }

  if (normalized.length === 0) {
    return [fallbackNetwork];
  }

  return normalized;
}

function parsePositiveInt(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;
  if (parsed > max) return fallback;
  return parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseCsvList(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const raw = fs.readFileSync(filePath, 'utf8');
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key) continue;

    let value = normalized.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export function createConfig(runtimeEnv = process.env) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const sefiRoot = join(__dirname, '..', '..');
  const shouldLoadDotEnv = runtimeEnv === process.env;
  const dotEnvValues = shouldLoadDotEnv ? parseDotEnvFile(join(sefiRoot, '.env')) : {};
  const env = {
    ...dotEnvValues,
    ...runtimeEnv,
  };

  const network = normalizeNetwork(env.SEFI_NETWORK);
  const networkConfig = SUPPORTED_NETWORKS[network];

  const mirrorRestBaseUrl = env.SEFI_MIRROR_NODE_URL || networkConfig.mirrorRest;
  const primaryMirrorPoolOverride = parseCsvList(env.SEFI_MIRROR_NODE_POOL, []);
  const networks = normalizeNetworks(env.SEFI_NETWORKS, network);
  const mirrorRestByNetwork = {};
  const mirrorRestPoolByNetwork = {};
  for (const targetNetwork of networks) {
    const supportedConfig = SUPPORTED_NETWORKS[targetNetwork];
    const resolvedPrimary =
      targetNetwork === network
        ? mirrorRestBaseUrl
        : supportedConfig.mirrorRest;
    mirrorRestByNetwork[targetNetwork] = resolvedPrimary;

    const defaultPool = Array.isArray(supportedConfig.mirrorRestPool) && supportedConfig.mirrorRestPool.length > 0
      ? supportedConfig.mirrorRestPool
      : [supportedConfig.mirrorRest];
    const poolSeed = targetNetwork === network && primaryMirrorPoolOverride.length > 0
      ? primaryMirrorPoolOverride
      : defaultPool;
    const orderedPool = [resolvedPrimary, ...poolSeed.filter((candidate) => candidate !== resolvedPrimary)];
    mirrorRestPoolByNetwork[targetNetwork] = Array.from(new Set(orderedPool));
  }

  const config = {
    protocolName: 'SeFi',
    host: env.SEFI_HOST || '0.0.0.0',
    network,
    networks,
    mirrorRestBaseUrl,
    mirrorRestByNetwork,
    mirrorRestPoolByNetwork,
    port: parsePositiveInt(env.SEFI_PORT, 3210, 1, 65535),
    pageLimit: parsePositiveInt(env.SEFI_PAGE_LIMIT, 100, 1, 100),
    requestDelayMs: parsePositiveInt(env.SEFI_REQUEST_DELAY_MS, 0, 0, 120000),
    backfillDelayMs: parsePositiveInt(env.SEFI_BACKFILL_DELAY_MS, 0, 0, 120000),
    listenDelayMs: parsePositiveInt(env.SEFI_LISTEN_DELAY_MS, 1000, 1000, 300000),
    maxRetries: parsePositiveInt(env.SEFI_MAX_RETRIES, 3, 1, 20),
    retryDelayMs: parsePositiveInt(env.SEFI_RETRY_DELAY_MS, 2000, 1, 120000),
    rateLimitCooldownMs: parsePositiveInt(env.SEFI_RATE_LIMIT_COOLDOWN_MS, 60000, 1000, 300000),
    saveIntervalMs: parsePositiveInt(env.SEFI_SAVE_INTERVAL_MS, 30000, 1000, 3600000),
    saveDebounceMs: parsePositiveInt(env.SEFI_SAVE_DEBOUNCE_MS, 5000, 250, 60000),
    derivedEnabled: parseBoolean(env.SEFI_DERIVED_ENABLED, true),
    derivedBatchSize: parsePositiveInt(env.SEFI_DERIVED_BATCH_SIZE, 2000, 100, 50000),
    derivedReconcileCron: env.SEFI_DERIVED_RECONCILE_CRON || '0 2 * * *',
    indexDeferContractNames: parseCsvList(env.SEFI_INDEX_DEFER_CONTRACT_NAMES, []).map((value) =>
      String(value || '').trim().toLowerCase()
    ),
    bonzoApiBaseUrl: env.SEFI_BONZO_API_BASE_URL || 'https://data.bonzo.finance/',
    externalSourceTimeoutMs: parsePositiveInt(env.SEFI_EXTERNAL_SOURCE_TIMEOUT_MS, 8000, 500, 120000),
    externalSourceMaxRetries: parsePositiveInt(env.SEFI_EXTERNAL_SOURCE_MAX_RETRIES, 3, 0, 10),
    manifestsDir: env.SEFI_MANIFESTS_DIR || join(sefiRoot, 'contracts', 'manifests'),
    dbPath: env.SEFI_DB_PATH || join(sefiRoot, 'data', 'sefi.db'),
    cubeDbPath: env.SEFI_CUBE_DB_PATH || join(sefiRoot, 'data', 'sefi.cube.db'),
    cubeModelDir: env.SEFI_CUBE_MODEL_DIR || join(sefiRoot, 'cube', 'model'),
    maxDbSizeBytes: parsePositiveInt(env.SEFI_MAX_DB_SIZE_BYTES, 10 * 1024 * 1024 * 1024, 1024 * 1024, Number.MAX_SAFE_INTEGER),
    mirrorRequestTimeoutMs: parsePositiveInt(env.SEFI_REQUEST_TIMEOUT_MS, 15000, 1000, 300000),
    mirrorPoolProbeEnabled: parseBoolean(env.SEFI_MIRROR_POOL_PROBE_ENABLED, true),
    mirrorPoolProbeTimeoutMs: parsePositiveInt(env.SEFI_MIRROR_POOL_PROBE_TIMEOUT_MS, 1500, 250, 60000),
    mirrorPoolProbePath: env.SEFI_MIRROR_POOL_PROBE_PATH || '/api/v1/network/nodes?limit=1',
    cubeApiUrl: env.SEFI_CUBE_API_URL || 'http://127.0.0.1:4100/cubejs-api/v1',
    cubeApiToken: env.SEFI_CUBE_API_TOKEN || '',
    cubeHealthTimeoutMs: parsePositiveInt(env.SEFI_CUBE_HEALTH_TIMEOUT_MS, 10000, 250, 30000),
    cubeHealthCacheTtlMs: parsePositiveInt(env.SEFI_CUBE_HEALTH_CACHE_TTL_MS, 1500, 0, 30000),
    cubeProbeBaseIntervalMs: parsePositiveInt(env.SEFI_CUBE_PROBE_INTERVAL_MS, 4000, 500, 300000),
    cubeProbeFailureIntervalMs: parsePositiveInt(env.SEFI_CUBE_PROBE_FAILURE_INTERVAL_MS, 12000, 1000, 600000),
    cubeProbeJitterMs: parsePositiveInt(env.SEFI_CUBE_PROBE_JITTER_MS, 600, 0, 30000),
    cubeProbeFailureThreshold: parsePositiveInt(env.SEFI_CUBE_PROBE_FAILURE_THRESHOLD, 3, 1, 100),
    statusProbeIntervalMs: parsePositiveInt(env.SEFI_STATUS_PROBE_INTERVAL_MS, 3000, 500, 300000),
    statusStaleAfterMs: parsePositiveInt(env.SEFI_STATUS_STALE_AFTER_MS, 20000, 1000, 600000),
    statusStreamIntervalMs: parsePositiveInt(env.SEFI_STATUS_STREAM_INTERVAL_MS, 3000, 500, 300000),
    statusStreamHeartbeatMs: parsePositiveInt(env.SEFI_STATUS_STREAM_HEARTBEAT_MS, 15000, 1000, 300000),
    dbMetricsCacheTtlMs: parsePositiveInt(env.SEFI_DB_METRICS_CACHE_TTL_MS, 4000, 250, 600000),
    dbReadProbeMaxAgeMs: parsePositiveInt(env.SEFI_DB_READ_PROBE_MAX_AGE_MS, 15000, 1000, 600000),
    apiToken: env.SEFI_API_TOKEN || '',
    requireAuth: parseBoolean(env.SEFI_REQUIRE_AUTH, false),
    demoMode: parseBoolean(env.SEFI_DEMO_MODE, false),
    demoAccessKey: env.SEFI_DEMO_ACCESS_KEY || '',
    allowedOrigins: parseCsvList(
      env.SEFI_ALLOWED_ORIGINS,
      env.SEFI_API_TOKEN ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : ['*']
    ),
    sessionCookieName: env.SEFI_SESSION_COOKIE_NAME || 'sefi_session',
    sessionTtlSeconds: parsePositiveInt(env.SEFI_SESSION_TTL_SECONDS, 43200, 300, 31 * 24 * 60 * 60),
    sessionSecureCookie: parseBoolean(env.SEFI_SESSION_SECURE_COOKIE, false),
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiApiBaseUrl: env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
    openaiModelFast: env.OPENAI_MODEL_FAST || 'gpt-5-mini',
    openaiModelStrong: env.OPENAI_MODEL_STRONG || 'gpt-5',
    agentAutoExecuteDefault: parseBoolean(env.SEFI_AGENT_AUTO_EXECUTE_DEFAULT, true),
    agentSqlFallbackDefault: parseBoolean(env.SEFI_AGENT_SQL_FALLBACK_DEFAULT, false),
    agentMaxQuestionChars: parsePositiveInt(env.SEFI_AGENT_MAX_QUESTION_CHARS, 2000, 100, 20000),
    agentAutonomousNetworks: parseCsvList(env.SEFI_AGENT_AUTONOMOUS_NETWORKS, ['testnet']),
    elizaBaseUrl: env.SEFI_ELIZA_BASE_URL || 'http://127.0.0.1:3001',
    elizaApiKey: env.SEFI_ELIZA_API_KEY || '',
  };

  if (config.requireAuth && !config.apiToken && !config.demoAccessKey) {
    throw new Error('SEFI_REQUIRE_AUTH=true requires SEFI_API_TOKEN or SEFI_DEMO_ACCESS_KEY');
  }

  return config;
}
