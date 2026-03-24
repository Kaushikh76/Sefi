import crypto from 'crypto';

const BUILTIN_BONZO_SOURCE_SLUG = 'bonzo-market';
const BUILTIN_BONZO_SOURCE_PRESET = 'bonzo_market';
const BUILTIN_PIPELINE_KEYS = new Set([
  'clmm_pool_snapshots',
  'clmm_positions',
  'vault_strategy_state',
  'vault_actions_decoded',
  'price_volatility_snapshots',
  'clmm_agent_state',
]);

const VAULT_ACTION_SOURCE_CATEGORIES = Object.freeze([
  'vault-single-vault',
  'vault-dual-vault',
  'vault-lst-vault',
  'vault-single-strategy',
  'vault-dual-strategy',
  'vault-lst-strategy',
  'vault-single-core',
  'vault-dual-core',
]);

const VAULT_IDENTITY_CATEGORIES = new Set(['vault-single-vault', 'vault-dual-vault', 'vault-lst-vault']);

const BUILTIN_PIPELINE_CONTRACT_FILTERS = Object.freeze({
  clmm_pool_snapshots: {
    include_contains: ['pool'],
    exclude_prefixes: ['lend-'],
  },
  clmm_positions: {
    include_contains: ['pool', 'strategy'],
    exclude_prefixes: ['lend-'],
  },
  vault_actions_decoded: {
    include_categories: VAULT_ACTION_SOURCE_CATEGORIES,
  },
  vault_strategy_state: {
    include_contains: ['pool', 'strategy', 'core', 'vault'],
    exclude_prefixes: ['lend-'],
  },
});

const DERIVED_REBUILD_TARGET_TABLE_BY_PRESET = Object.freeze({
  clmm_pool_snapshots: 'clmm_pool_snapshots',
  clmm_positions: 'clmm_positions',
  vault_actions_decoded: 'vault_actions_decoded',
  vault_strategy_state: 'vault_strategy_state',
  price_volatility_snapshots: 'price_volatility_snapshots',
});

const BUILTIN_PIPELINE_TABLE_SHAPES = {
  clmm_pool_snapshots: {
    keyColumns: ['snapshot_id'],
    columns: [
      { name: 'snapshot_id', type: 'TEXT', primary_key: true },
      { name: 'pool_address', type: 'TEXT' },
      { name: 'dex_name', type: 'TEXT' },
      { name: 'token0_symbol', type: 'TEXT' },
      { name: 'token1_symbol', type: 'TEXT' },
      { name: 'fee_tier_bps', type: 'REAL' },
      { name: 'current_tick', type: 'REAL' },
      { name: 'sqrt_price_x96', type: 'TEXT' },
      { name: 'spot_price', type: 'REAL' },
      { name: 'active_liquidity', type: 'REAL' },
      { name: 'tvl_usd', type: 'REAL' },
      { name: 'block_number', type: 'REAL' },
      { name: 'snapshot_at', type: 'TEXT' },
      { name: 'indexed_at', type: 'TEXT' },
    ],
  },
  clmm_positions: {
    keyColumns: ['position_id'],
    columns: [
      { name: 'position_id', type: 'TEXT', primary_key: true },
      { name: 'pool_address', type: 'TEXT' },
      { name: 'vault_address', type: 'TEXT' },
      { name: 'strategy_address', type: 'TEXT' },
      { name: 'owner_address', type: 'TEXT' },
      { name: 'token0_symbol', type: 'TEXT' },
      { name: 'token1_symbol', type: 'TEXT' },
      { name: 'tick_lower', type: 'REAL' },
      { name: 'tick_upper', type: 'REAL' },
      { name: 'liquidity', type: 'REAL' },
      { name: 'amount0', type: 'REAL' },
      { name: 'amount1', type: 'REAL' },
      { name: 'fees_owed0', type: 'REAL' },
      { name: 'fees_owed1', type: 'REAL' },
      { name: 'is_active', type: 'INTEGER' },
      { name: 'minted_at', type: 'TEXT' },
      { name: 'last_updated_at', type: 'TEXT' },
      { name: 'indexed_at', type: 'TEXT' },
    ],
  },
  vault_strategy_state: {
    keyColumns: ['vault_address'],
    columns: [
      { name: 'vault_address', type: 'TEXT', primary_key: true },
      { name: 'vault_name', type: 'TEXT' },
      { name: 'strategy_address', type: 'TEXT' },
      { name: 'pool_address', type: 'TEXT' },
      { name: 'asset_pair', type: 'TEXT' },
      { name: 'current_position_id', type: 'TEXT' },
      { name: 'token0_symbol', type: 'TEXT' },
      { name: 'token1_symbol', type: 'TEXT' },
      { name: 'current_tick', type: 'REAL' },
      { name: 'active_lower_tick', type: 'REAL' },
      { name: 'active_upper_tick', type: 'REAL' },
      { name: 'in_range', type: 'INTEGER' },
      { name: 'distance_to_lower', type: 'REAL' },
      { name: 'distance_to_upper', type: 'REAL' },
      { name: 'idle_ratio', type: 'REAL' },
      { name: 'deployed_ratio', type: 'REAL' },
      { name: 'idle_usd', type: 'REAL' },
      { name: 'deployed_usd', type: 'REAL' },
      { name: 'tvl_usd', type: 'REAL' },
      { name: 'share_price', type: 'REAL' },
      { name: 'rebalance_count_24h', type: 'REAL' },
      { name: 'last_rebalance_at', type: 'TEXT' },
      { name: 'state_at', type: 'TEXT' },
      { name: 'indexed_at', type: 'TEXT' },
    ],
  },
  vault_actions_decoded: {
    keyColumns: ['action_id'],
    columns: [
      { name: 'action_id', type: 'TEXT', primary_key: true },
      { name: 'vault_address', type: 'TEXT' },
      { name: 'strategy_address', type: 'TEXT' },
      { name: 'pool_address', type: 'TEXT' },
      { name: 'tx_hash', type: 'TEXT' },
      { name: 'actor_address', type: 'TEXT' },
      { name: 'action_type', type: 'TEXT' },
      { name: 'position_id', type: 'TEXT' },
      { name: 'tick_lower', type: 'REAL' },
      { name: 'tick_upper', type: 'REAL' },
      { name: 'amount0', type: 'REAL' },
      { name: 'amount1', type: 'REAL' },
      { name: 'shares', type: 'REAL' },
      { name: 'value_usd', type: 'REAL' },
      { name: 'block_number', type: 'REAL' },
      { name: 'action_at', type: 'TEXT' },
      { name: 'indexed_at', type: 'TEXT' },
    ],
  },
  price_volatility_snapshots: {
    keyColumns: ['snapshot_id'],
    columns: [
      { name: 'snapshot_id', type: 'TEXT', primary_key: true },
      { name: 'market_key', type: 'TEXT' },
      { name: 'base_symbol', type: 'TEXT' },
      { name: 'quote_symbol', type: 'TEXT' },
      { name: 'source', type: 'TEXT' },
      { name: 'interval_label', type: 'TEXT' },
      { name: 'price', type: 'REAL' },
      { name: 'return_1h', type: 'REAL' },
      { name: 'return_6h', type: 'REAL' },
      { name: 'return_24h', type: 'REAL' },
      { name: 'realized_vol_1h', type: 'REAL' },
      { name: 'realized_vol_6h', type: 'REAL' },
      { name: 'realized_vol_24h', type: 'REAL' },
      { name: 'snapshot_at', type: 'TEXT' },
      { name: 'indexed_at', type: 'TEXT' },
    ],
  },
  clmm_agent_state: {
    keyColumns: ['state_id'],
    columns: [
      { name: 'state_id', type: 'TEXT', primary_key: true },
      { name: 'vault_address', type: 'TEXT' },
      { name: 'vault_name', type: 'TEXT' },
      { name: 'strategy_address', type: 'TEXT' },
      { name: 'pool_address', type: 'TEXT' },
      { name: 'asset_pair', type: 'TEXT' },
      { name: 'current_tick', type: 'REAL' },
      { name: 'active_lower_tick', type: 'REAL' },
      { name: 'active_upper_tick', type: 'REAL' },
      { name: 'in_range', type: 'INTEGER' },
      { name: 'distance_to_lower', type: 'REAL' },
      { name: 'distance_to_upper', type: 'REAL' },
      { name: 'nearest_boundary_distance', type: 'REAL' },
      { name: 'idle_ratio', type: 'REAL' },
      { name: 'deployed_ratio', type: 'REAL' },
      { name: 'tvl_usd', type: 'REAL' },
      { name: 'realized_vol_1h', type: 'REAL' },
      { name: 'realized_vol_6h', type: 'REAL' },
      { name: 'realized_vol_24h', type: 'REAL' },
      { name: 'risk_regime', type: 'TEXT' },
      { name: 'suggested_action', type: 'TEXT' },
      { name: 'confidence_score', type: 'REAL' },
      { name: 'reason_summary', type: 'TEXT' },
      { name: 'last_rebalance_at', type: 'TEXT' },
      { name: 'state_at', type: 'TEXT' },
      { name: 'indexed_at', type: 'TEXT' },
    ],
  },
};

function nowIso() {
  return new Date().toISOString();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseJsonText(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensurePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function toSafeString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function escapeSqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toIsoFromConsensusTimestamp(timestamp) {
  const text = String(timestamp || '').trim();
  if (!text) return null;
  const [secondsRaw, nanosRaw = '0'] = text.split('.');
  const seconds = Number.parseInt(secondsRaw, 10);
  if (!Number.isFinite(seconds)) return null;
  const nanos = Number.parseInt(String(nanosRaw).slice(0, 9).padEnd(9, '0'), 10);
  if (!Number.isFinite(nanos)) return null;
  const millis = seconds * 1000 + Math.floor(nanos / 1_000_000);
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function splitAssetPair(asset, fallbackName = '') {
  const raw = String(asset || '').trim();
  const candidate = raw || String(fallbackName || '').trim();
  if (!candidate) {
    return {
      token0_symbol: null,
      token1_symbol: null,
      asset_pair: null,
    };
  }

  const separator = ['/', '-', ':', '_'].find((item) => candidate.includes(item));
  if (separator) {
    const tokens = candidate
      .split(separator)
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean);
    if (tokens.length >= 2) {
      return {
        token0_symbol: tokens[0],
        token1_symbol: tokens[1],
        asset_pair: `${tokens[0]}/${tokens[1]}`,
      };
    }
  }

  const extracted = candidate.match(/[A-Za-z]{2,10}/g) || [];
  if (extracted.length >= 2) {
    const token0 = extracted[0].toUpperCase();
    const token1 = extracted[1].toUpperCase();
    return {
      token0_symbol: token0,
      token1_symbol: token1,
      asset_pair: `${token0}/${token1}`,
    };
  }

  return {
    token0_symbol: null,
    token1_symbol: null,
    asset_pair: null,
  };
}

function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith('0x') && text.length === 42) return text;
  if (/^\d+\.\d+\.\d+$/.test(text)) return text;
  return text;
}

function normalizeTopicAddress(topicValue) {
  const raw = String(topicValue || '').trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (normalized.length < 40) return null;
  const candidate = normalized.slice(-40);
  if (!/^[0-9a-f]{40}$/.test(candidate)) return null;
  return `0x${candidate}`;
}

function decodeHexWords(hexValue) {
  const raw = String(hexValue || '').trim().toLowerCase();
  if (!raw || raw === '0x') return [];
  const body = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!body || body.length % 64 !== 0 || !/^[0-9a-f]+$/.test(body)) {
    return [];
  }
  const words = [];
  for (let offset = 0; offset < body.length; offset += 64) {
    words.push(body.slice(offset, offset + 64));
  }
  return words;
}

function wordToBigInt(word) {
  if (!word) return null;
  try {
    return BigInt(`0x${word}`);
  } catch {
    return null;
  }
}

function wordToSignedBigInt(word, bits = 256n) {
  const unsigned = wordToBigInt(word);
  if (unsigned === null) return null;
  const max = 1n << bits;
  const half = 1n << (bits - 1n);
  if (unsigned >= half) {
    return unsigned - max;
  }
  return unsigned;
}

function wordToInt24(word) {
  if (!word) return null;
  const low = word.slice(-6);
  const value = Number.parseInt(low, 16);
  if (!Number.isFinite(value)) return null;
  if (value >= 0x800000) return value - 0x1000000;
  return value;
}

function bigIntToNumber(value) {
  if (typeof value !== 'bigint') return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  return asNumber;
}

function decodeSwapEvent(dataHex) {
  const words = decodeHexWords(dataHex);
  if (words.length < 5) {
    return null;
  }
  const amount0 = wordToSignedBigInt(words[0]);
  const amount1 = wordToSignedBigInt(words[1]);
  const sqrtPriceX96 = wordToBigInt(words[2]);
  const liquidity = wordToBigInt(words[3]);
  const tick = wordToInt24(words[4]);

  let spotPrice = null;
  if (sqrtPriceX96 !== null) {
    const sqrtRatio = Number(sqrtPriceX96) / 2 ** 96;
    if (Number.isFinite(sqrtRatio)) {
      spotPrice = sqrtRatio * sqrtRatio;
      if (!Number.isFinite(spotPrice)) spotPrice = null;
    }
  }

  return {
    amount0: bigIntToNumber(amount0),
    amount1: bigIntToNumber(amount1),
    sqrt_price_x96: sqrtPriceX96 === null ? null : sqrtPriceX96.toString(),
    liquidity: bigIntToNumber(liquidity),
    tick,
    spot_price: spotPrice,
  };
}

function decodeMintBurnEvent(dataHex) {
  const words = decodeHexWords(dataHex);
  if (words.length < 5) {
    return null;
  }

  return {
    tick_lower: wordToInt24(words[0]),
    tick_upper: wordToInt24(words[1]),
    liquidity: bigIntToNumber(wordToBigInt(words[2])),
    amount0: bigIntToNumber(wordToBigInt(words[3])),
    amount1: bigIntToNumber(wordToBigInt(words[4])),
  };
}

function decodeCollectEvent(dataHex) {
  const words = decodeHexWords(dataHex);
  if (words.length < 4) {
    return null;
  }

  return {
    tick_lower: wordToInt24(words[0]),
    tick_upper: wordToInt24(words[1]),
    amount0: bigIntToNumber(wordToBigInt(words[2])),
    amount1: bigIntToNumber(wordToBigInt(words[3])),
  };
}

function isPoolLike(row) {
  const category = String(row?.category || '').toLowerCase();
  const name = String(row?.canonical_name || '').toLowerCase();
  if (category.includes('pool') || category.includes('clmm') || category.includes('amm') || category.includes('dex')) {
    return true;
  }
  if (name.includes('pool') || name.includes('lp') || name.includes('clmm')) {
    return true;
  }
  const eventName = String(row?.event_name || '');
  return ['Swap', 'Mint', 'Burn', 'Collect', 'Initialize', 'Flash'].includes(eventName);
}

function isVaultLike(row) {
  const category = String(row?.category || '').toLowerCase();
  const name = String(row?.canonical_name || '').toLowerCase();
  if (category.includes('vault') || category.includes('strategy')) {
    return true;
  }
  if (name.includes('vault') || name.includes('strategy') || name.includes('position manager')) {
    return true;
  }
  return false;
}

function normalizeActionType(eventName, topic0) {
  const normalizedName = String(eventName || '').trim();
  if (normalizedName && normalizedName.toLowerCase() !== 'unknown') {
    if (normalizedName.toLowerCase().startsWith('topic0:')) {
      return `topic0:${normalizedName.slice(7).trim().toLowerCase()}`;
    }
    return normalizedName;
  }

  const topic = String(topic0 || '').trim().toLowerCase();
  if (topic) {
    return `topic0:${topic}`;
  }
  return 'unknown';
}

function normalizeCategoryText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function categoryMatchesFilter(categoryValue, filter = {}) {
  const category = normalizeCategoryText(categoryValue);
  if (!category) return false;

  const includeCategories = normalizeStringArray(filter.include_categories);
  const includePrefixes = normalizeStringArray(filter.include_prefixes);
  const includeSuffixes = normalizeStringArray(filter.include_suffixes);
  const includeContains = normalizeStringArray(filter.include_contains);

  const hasIncludeRules =
    includeCategories.length > 0 ||
    includePrefixes.length > 0 ||
    includeSuffixes.length > 0 ||
    includeContains.length > 0;

  let includeMatched = !hasIncludeRules;
  if (!includeMatched) {
    if (includeCategories.includes(category)) includeMatched = true;
    if (!includeMatched && includePrefixes.some((prefix) => category.startsWith(prefix))) includeMatched = true;
    if (!includeMatched && includeSuffixes.some((suffix) => category.endsWith(suffix))) includeMatched = true;
    if (!includeMatched && includeContains.some((fragment) => category.includes(fragment))) includeMatched = true;
  }

  if (!includeMatched) {
    return false;
  }

  const excludeCategories = normalizeStringArray(filter.exclude_categories);
  const excludePrefixes = normalizeStringArray(filter.exclude_prefixes);
  const excludeSuffixes = normalizeStringArray(filter.exclude_suffixes);
  const excludeContains = normalizeStringArray(filter.exclude_contains);

  if (excludeCategories.includes(category)) return false;
  if (excludePrefixes.some((prefix) => category.startsWith(prefix))) return false;
  if (excludeSuffixes.some((suffix) => category.endsWith(suffix))) return false;
  if (excludeContains.some((fragment) => category.includes(fragment))) return false;

  return true;
}

function getByPath(input, dotPath) {
  if (!dotPath) return undefined;
  const parts = String(dotPath)
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  let value = input;
  for (const part of parts) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, part)) {
      value = value[part];
      continue;
    }
    return undefined;
  }
  return value;
}

function parseWadValue(value) {
  if (value === undefined || value === null || value === '') return null;
  try {
    const text = String(value).trim();
    const decimalFactor = 1_000_000_000_000_000_000n;
    let parsed;
    if (text.startsWith('0x') || text.startsWith('0X')) {
      parsed = BigInt(text);
    } else {
      parsed = BigInt(text);
    }
    const whole = parsed / decimalFactor;
    const fraction = parsed % decimalFactor;
    const composed = Number(`${whole}.${fraction.toString().padStart(18, '0').slice(0, 6)}`);
    if (!Number.isFinite(composed)) return null;
    return composed;
  } catch {
    return null;
  }
}

function normalizeBonzoReserveRecord(reserve, timestamp) {
  const evmAddress = normalizeAddress(reserve?.evm_address || reserve?.evmAddress);
  const htsAddress = normalizeAddress(reserve?.hts_address || reserve?.htsAddress);
  const symbol = String(reserve?.symbol || '').trim().toUpperCase() || null;
  const priceDisplay = parseNumber(reserve?.price_usd_display, null);
  const priceFromWad = parseWadValue(reserve?.price_usd_wad);
  const priceUsd = priceDisplay ?? priceFromWad;

  const normalized = {
    evm_address: evmAddress,
    hts_address: htsAddress,
    symbol,
    coingecko_id: reserve?.coingecko_id ? String(reserve.coingecko_id) : null,
    atoken_address: normalizeAddress(reserve?.atoken_address),
    stable_debt_address: normalizeAddress(reserve?.stable_debt_address),
    variable_debt_address: normalizeAddress(reserve?.variable_debt_address),
    price_usd_display: priceDisplay,
    price_usd_wad: reserve?.price_usd_wad ? String(reserve.price_usd_wad) : null,
    price_usd: priceUsd,
    timestamp: timestamp || null,
  };

  const recordKey =
    normalized.evm_address || normalized.hts_address || normalized.symbol || crypto.createHash('sha1').update(JSON.stringify(normalized)).digest('hex');

  return {
    record_key: String(recordKey),
    normalized,
  };
}

export function normalizeBonzoMarketPayload(payload) {
  const source = ensurePlainObject(payload) ? payload : {};
  const reserves = Array.isArray(source.reserves) ? source.reserves : [];
  const timestamp = source.timestamp ? String(source.timestamp) : null;

  const normalizedRecords = [];
  for (const reserve of reserves) {
    if (!ensurePlainObject(reserve)) continue;
    normalizedRecords.push(normalizeBonzoReserveRecord(reserve, timestamp));
  }

  return {
    timestamp,
    records: normalizedRecords,
  };
}

function parseAuthMode(value, fallback = 'none') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['none', 'api_key', 'bearer'].includes(normalized)) return normalized;
  return fallback;
}

function parseHttpMethod(value, fallback = 'GET') {
  const normalized = String(value || '').trim().toUpperCase();
  if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized)) return normalized;
  return fallback;
}

function normalizeSourceRequest(rawRequest = {}) {
  const request = ensurePlainObject(rawRequest) ? rawRequest : {};
  const params = ensurePlainObject(request.params) ? request.params : {};
  const headers = ensurePlainObject(request.headers) ? request.headers : {};
  const body = request.body === undefined ? null : request.body;

  return {
    path: String(request.path || '/').trim() || '/',
    method: parseHttpMethod(request.method, 'GET'),
    params,
    headers,
    body,
    timeout_ms: parseNumber(request.timeout_ms, null),
  };
}

function normalizeSourceNormalization(rawNormalization = {}) {
  const normalization = ensurePlainObject(rawNormalization) ? rawNormalization : {};
  const fields = ensurePlainObject(normalization.fields) ? normalization.fields : {};

  return {
    records_path: String(normalization.records_path || '').trim() || null,
    key_field: String(normalization.key_field || '').trim() || null,
    fields,
  };
}

function defaultBonzoSourceDefinition(baseUrl) {
  return {
    name: 'Bonzo Lend Market',
    slug: BUILTIN_BONZO_SOURCE_SLUG,
    description: 'Built-in Bonzo Lend market reserve data source for USD enrichment.',
    enabled: true,
    is_system: true,
    preset_key: BUILTIN_BONZO_SOURCE_PRESET,
    base_url: baseUrl,
    auth_mode: 'none',
    auth_config: {},
    request: {
      path: '/market',
      method: 'GET',
      params: {},
      headers: {},
      body: null,
      timeout_ms: null,
    },
    normalization: {
      records_path: 'reserves',
      key_field: 'evm_address',
      fields: {
        evm_address: 'evm_address',
        hts_address: 'hts_address',
        symbol: 'symbol',
        coingecko_id: 'coingecko_id',
        price_usd_display: 'price_usd_display',
        price_usd_wad: 'price_usd_wad',
      },
    },
  };
}

export function validateExternalSourceDefinition(input, { partial = false } = {}) {
  const payload = ensurePlainObject(input) ? input : {};
  const errors = [];

  const normalized = {
    name: undefined,
    slug: undefined,
    description: undefined,
    enabled: undefined,
    is_system: undefined,
    preset_key: undefined,
    base_url: undefined,
    auth_mode: undefined,
    auth_config: undefined,
    request: undefined,
    normalization: undefined,
  };

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = String(payload.name || '').trim();
    if (!name) {
      errors.push('name is required');
    }
    normalized.name = name;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'slug') || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const slug = slugify(payload.slug || payload.name);
    if (!slug) {
      errors.push('slug is required');
    }
    normalized.slug = slug;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'description')) {
    normalized.description = String(payload.description || '').trim();
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    normalized.enabled = parseBoolean(payload.enabled, true);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'is_system')) {
    normalized.is_system = parseBoolean(payload.is_system, false);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'preset_key')) {
    normalized.preset_key = payload.preset_key ? String(payload.preset_key).trim() : null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'base_url')) {
    const baseUrl = String(payload.base_url || '').trim();
    if (!baseUrl) {
      errors.push('base_url is required');
    } else {
      try {
        const parsed = new URL(baseUrl);
        normalized.base_url = parsed.toString().replace(/\/+$/, '/');
      } catch {
        errors.push('base_url must be a valid URL');
      }
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'auth_mode')) {
    const mode = parseAuthMode(payload.auth_mode, 'none');
    if (!['none', 'api_key', 'bearer'].includes(mode)) {
      errors.push('auth_mode must be one of none|api_key|bearer');
    }
    normalized.auth_mode = mode;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'auth_config')) {
    if (payload.auth_config !== undefined && payload.auth_config !== null && !ensurePlainObject(payload.auth_config)) {
      errors.push('auth_config must be an object when provided');
    }
    normalized.auth_config = ensurePlainObject(payload.auth_config) ? payload.auth_config : {};
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'request')) {
    normalized.request = normalizeSourceRequest(payload.request);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'normalization')) {
    normalized.normalization = normalizeSourceNormalization(payload.normalization);
  }

  return {
    value: normalized,
    errors,
  };
}

function defaultBuiltinPipelineSpec(builtinKey) {
  if (builtinKey === 'clmm_agent_state') {
    return {
      kind: 'builtin',
      builtin_key: builtinKey,
      source_cursor_column: null,
      notes: 'v1 schema-only table; no automatic population in this release.',
    };
  }

  return {
    kind: 'builtin',
    builtin_key: builtinKey,
    source_cursor_column: 'contract_logs.id',
    reconcile_window_rows: 250000,
  };
}

function defaultBuiltinPipelines() {
  return [
    {
      name: 'CLMM Pool Snapshots',
      slug: 'clmm-pool-snapshots',
      description: 'Derived CLMM pool snapshots from indexed contract logs.',
      preset_key: 'clmm_pool_snapshots',
      target_table: 'clmm_pool_snapshots',
      enabled: true,
      realtime_enabled: true,
      is_system: true,
      schedule: {
        mode: 'realtime_with_reconcile',
      },
      spec: defaultBuiltinPipelineSpec('clmm_pool_snapshots'),
    },
    {
      name: 'CLMM Positions',
      slug: 'clmm-positions',
      description: 'Derived CLMM position state from mint/burn/collect logs.',
      preset_key: 'clmm_positions',
      target_table: 'clmm_positions',
      enabled: true,
      realtime_enabled: true,
      is_system: true,
      schedule: {
        mode: 'realtime_with_reconcile',
      },
      spec: defaultBuiltinPipelineSpec('clmm_positions'),
    },
    {
      name: 'Vault Actions Decoded',
      slug: 'vault-actions-decoded',
      description: 'Decoded vault actions from indexed contract logs.',
      preset_key: 'vault_actions_decoded',
      target_table: 'vault_actions_decoded',
      enabled: true,
      realtime_enabled: true,
      is_system: true,
      schedule: {
        mode: 'realtime_with_reconcile',
      },
      spec: defaultBuiltinPipelineSpec('vault_actions_decoded'),
    },
    {
      name: 'Vault Strategy State',
      slug: 'vault-strategy-state',
      description: 'Latest derived state per vault strategy.',
      preset_key: 'vault_strategy_state',
      target_table: 'vault_strategy_state',
      enabled: true,
      realtime_enabled: true,
      is_system: true,
      schedule: {
        mode: 'realtime_with_reconcile',
      },
      spec: defaultBuiltinPipelineSpec('vault_strategy_state'),
    },
    {
      name: 'Price Volatility Snapshots',
      slug: 'price-volatility-snapshots',
      description: 'Derived price/return/volatility snapshots from pool snapshots.',
      preset_key: 'price_volatility_snapshots',
      target_table: 'price_volatility_snapshots',
      enabled: true,
      realtime_enabled: true,
      is_system: true,
      schedule: {
        mode: 'realtime_with_reconcile',
      },
      spec: {
        kind: 'builtin',
        builtin_key: 'price_volatility_snapshots',
        source_cursor_column: 'clmm_pool_snapshots.rowid',
        reconcile_window_rows: 500000,
      },
    },
    {
      name: 'CLMM Agent State (Schema Only)',
      slug: 'clmm-agent-state',
      description: 'Schema table for future agent decisions. Not auto-populated in v1.',
      preset_key: 'clmm_agent_state',
      target_table: 'clmm_agent_state',
      enabled: true,
      realtime_enabled: false,
      is_system: true,
      schedule: {
        mode: 'manual',
      },
      spec: defaultBuiltinPipelineSpec('clmm_agent_state'),
    },
  ];
}

function normalizeSqlPipelineSpec(rawSpec = {}) {
  const spec = ensurePlainObject(rawSpec) ? rawSpec : {};
  const keyColumns = Array.isArray(spec.key_columns)
    ? spec.key_columns.map((column) => String(column || '').trim()).filter(Boolean)
    : [];
  const targetColumns = Array.isArray(spec.target_columns)
    ? spec.target_columns
        .map((entry) => {
          if (typeof entry === 'string') {
            return { name: String(entry).trim(), type: 'TEXT', primary_key: false };
          }
          if (!ensurePlainObject(entry)) return null;
          const name = String(entry.name || '').trim();
          if (!name) return null;
          const type = String(entry.type || 'TEXT').trim().toUpperCase();
          return {
            name,
            type,
            primary_key: parseBoolean(entry.primary_key, false),
          };
        })
        .filter(Boolean)
    : [];

  return {
    kind: 'sql_transform',
    source_sql: String(spec.source_sql || '').trim(),
    cursor_column: spec.cursor_column ? String(spec.cursor_column).trim() : null,
    key_columns: keyColumns,
    column_mappings: ensurePlainObject(spec.column_mappings) ? spec.column_mappings : {},
    defaults: ensurePlainObject(spec.defaults) ? spec.defaults : {},
    target_columns: targetColumns,
    enrichment: Array.isArray(spec.enrichment) ? spec.enrichment.filter((entry) => ensurePlainObject(entry)) : [],
  };
}

export function validateDerivedPipelineDefinition(input, { partial = false } = {}) {
  const payload = ensurePlainObject(input) ? input : {};
  const errors = [];

  const normalized = {
    name: undefined,
    slug: undefined,
    description: undefined,
    enabled: undefined,
    realtime_enabled: undefined,
    is_system: undefined,
    preset_key: undefined,
    target_table: undefined,
    schedule: undefined,
    spec: undefined,
  };

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = String(payload.name || '').trim();
    if (!name) {
      errors.push('name is required');
    }
    normalized.name = name;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'slug') || Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const slug = slugify(payload.slug || payload.name);
    if (!slug) {
      errors.push('slug is required');
    }
    normalized.slug = slug;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'description')) {
    normalized.description = String(payload.description || '').trim();
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'enabled')) {
    normalized.enabled = parseBoolean(payload.enabled, true);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'realtime_enabled')) {
    normalized.realtime_enabled = parseBoolean(payload.realtime_enabled, true);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'is_system')) {
    normalized.is_system = parseBoolean(payload.is_system, false);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'preset_key')) {
    normalized.preset_key = payload.preset_key ? String(payload.preset_key).trim() : null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'target_table')) {
    const tableName = String(payload.target_table || '').trim();
    if (!tableName) {
      errors.push('target_table is required');
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
      errors.push('target_table must be a valid SQLite table identifier');
    }
    normalized.target_table = tableName;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'schedule')) {
    normalized.schedule = ensurePlainObject(payload.schedule) ? payload.schedule : {};
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'spec') || Object.prototype.hasOwnProperty.call(payload, 'preset_key')) {
    const inputSpec = ensurePlainObject(payload.spec) ? payload.spec : {};
    const kind = String(inputSpec.kind || (payload.preset_key ? 'builtin' : 'sql_transform')).trim().toLowerCase();
    if (kind === 'builtin') {
      const builtinKey = String(inputSpec.builtin_key || payload.preset_key || '').trim();
      if (!BUILTIN_PIPELINE_KEYS.has(builtinKey)) {
        errors.push(`spec.builtin_key must be one of: ${Array.from(BUILTIN_PIPELINE_KEYS).join(', ')}`);
      }
      normalized.spec = {
        kind: 'builtin',
        builtin_key: builtinKey,
        source_cursor_column: inputSpec.source_cursor_column ? String(inputSpec.source_cursor_column) : 'contract_logs.id',
        reconcile_window_rows: parseNumber(inputSpec.reconcile_window_rows, 250000),
      };
    } else if (kind === 'sql_transform') {
      const spec = normalizeSqlPipelineSpec(inputSpec);
      if (!spec.source_sql) {
        errors.push('spec.source_sql is required for sql_transform pipelines');
      }
      if (!Array.isArray(spec.key_columns)) {
        errors.push('spec.key_columns must be an array');
      }
      normalized.spec = spec;
    } else {
      errors.push('spec.kind must be builtin|sql_transform');
    }
  }

  return {
    value: normalized,
    errors,
  };
}

function shouldTriggerDerivedIncremental(eventName, payload = {}) {
  const event = String(eventName || '').trim();
  if (!event) return false;

  if (['logs_indexed', 'hts_indexed', 'topic_messages_indexed'].includes(event)) {
    const inserted = Number(payload.inserted || 0);
    const erc20Inserted = Number(payload.erc20Inserted || 0);
    return inserted > 0 || erc20Inserted > 0;
  }

  return false;
}

function cronMatchesNow(cronExpr, timestampMs, lastRunKey = '') {
  const cron = String(cronExpr || '').trim();
  if (!cron) return false;
  const fields = cron.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    return false;
  }

  const [minuteField, hourField] = fields;
  const date = new Date(timestampMs);
  const minute = date.getMinutes();
  const hour = date.getHours();

  const minuteMatches = minuteField === '*' || Number.parseInt(minuteField, 10) === minute;
  const hourMatches = hourField === '*' || Number.parseInt(hourField, 10) === hour;
  if (!minuteMatches || !hourMatches) return false;

  const currentKey = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}-${hour}-${minute}`;
  if (currentKey === lastRunKey) return false;
  return true;
}

function pickLatestIso(...values) {
  let best = null;
  for (const value of values) {
    if (!value) continue;
    const ts = Date.parse(String(value));
    if (!Number.isFinite(ts)) continue;
    if (!best || ts > best.ts) {
      best = { ts, iso: new Date(ts).toISOString() };
    }
  }
  return best ? best.iso : null;
}

function resolveMappedValue(mapping, row, defaults = {}) {
  if (mapping === null) return null;
  if (mapping === undefined) return undefined;

  if (typeof mapping === 'string') {
    if (mapping.startsWith('$')) {
      const key = mapping.slice(1);
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        return row[key];
      }
      return defaults[key] ?? null;
    }
    return mapping;
  }

  if (typeof mapping === 'number' || typeof mapping === 'boolean') {
    return mapping;
  }

  if (ensurePlainObject(mapping)) {
    const type = String(mapping.type || 'literal').toLowerCase();
    if (type === 'literal') {
      return Object.prototype.hasOwnProperty.call(mapping, 'value') ? mapping.value : null;
    }

    if (type === 'field') {
      const field = String(mapping.field || '').trim();
      return field && Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null;
    }

    if (type === 'lower') {
      const field = String(mapping.field || '').trim();
      const value = field && Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null;
      return value === null || value === undefined ? null : String(value).toLowerCase();
    }

    if (type === 'number') {
      const field = String(mapping.field || '').trim();
      const value = field && Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null;
      return parseNumber(value, null);
    }

    if (type === 'coalesce') {
      const fields = Array.isArray(mapping.fields) ? mapping.fields.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
        const candidate = row[field];
        if (candidate !== null && candidate !== undefined && candidate !== '') {
          return candidate;
        }
      }
      return Object.prototype.hasOwnProperty.call(mapping, 'fallback') ? mapping.fallback : null;
    }
  }

  return null;
}

function buildPipelineUpsertStatement(db, tableName, columns, keyColumns) {
  const insertColumns = columns.map((column) => escapeIdentifier(column)).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  if (Array.isArray(keyColumns) && keyColumns.length > 0) {
    const updateColumns = columns.filter((column) => !keyColumns.includes(column));
    const updateSet = updateColumns
      .map((column) => `${escapeIdentifier(column)} = excluded.${escapeIdentifier(column)}`)
      .join(', ');

    const sql = updateColumns.length > 0
      ? `INSERT INTO ${escapeIdentifier(tableName)} (${insertColumns}) VALUES (${placeholders})
         ON CONFLICT(${keyColumns.map((column) => escapeIdentifier(column)).join(', ')}) DO UPDATE SET ${updateSet}`
      : `INSERT OR IGNORE INTO ${escapeIdentifier(tableName)} (${insertColumns}) VALUES (${placeholders})`;
    return db.prepare(sql);
  }

  return db.prepare(`INSERT INTO ${escapeIdentifier(tableName)} (${insertColumns}) VALUES (${placeholders})`);
}

function toSqlColumnType(inputType) {
  const normalized = String(inputType || '').trim().toUpperCase();
  if (['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'].includes(normalized)) {
    return normalized;
  }
  return 'TEXT';
}

function getBuiltinTableShape(builtinKey) {
  const shape = BUILTIN_PIPELINE_TABLE_SHAPES[String(builtinKey || '').trim()];
  if (!shape) {
    return {
      columns: [],
      keyColumns: [],
    };
  }

  return {
    columns: Array.isArray(shape.columns) ? shape.columns.map((entry) => ({ ...entry })) : [],
    keyColumns: Array.isArray(shape.keyColumns) ? [...shape.keyColumns] : [],
  };
}

function applySourceAuthHeaders(source, headers = {}) {
  const authMode = parseAuthMode(source.auth_mode, 'none');
  const authConfig = ensurePlainObject(source.auth_config) ? source.auth_config : {};
  const output = {
    ...headers,
  };

  if (authMode === 'api_key') {
    const headerName = String(authConfig.header_name || 'x-api-key').trim() || 'x-api-key';
    const apiKey = String(authConfig.api_key || authConfig.token || '').trim();
    if (apiKey) {
      output[headerName] = apiKey;
    }
  } else if (authMode === 'bearer') {
    const token = String(authConfig.bearer_token || authConfig.token || '').trim();
    if (token) {
      output.Authorization = `Bearer ${token}`;
    }
  }

  return output;
}

function buildSourceRequestUrl(source) {
  const request = ensurePlainObject(source.request) ? source.request : {};
  const params = ensurePlainObject(request.params) ? request.params : {};

  const url = new URL(String(request.path || '/'), source.base_url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function normalizeSourceRecords(source, payload) {
  if (source.preset_key === BUILTIN_BONZO_SOURCE_PRESET) {
    return normalizeBonzoMarketPayload(payload).records.map((entry) => ({
      record_key: entry.record_key,
      payload: payload,
      normalized: entry.normalized,
    }));
  }

  const normalization = ensurePlainObject(source.normalization) ? source.normalization : {};
  const request = ensurePlainObject(source.request) ? source.request : {};
  const recordsPath = normalization.records_path || null;
  const keyField = normalization.key_field || null;
  const fieldMap = ensurePlainObject(normalization.fields) ? normalization.fields : {};

  let records = [];
  if (recordsPath) {
    const value = getByPath(payload, recordsPath);
    if (Array.isArray(value)) {
      records = value;
    } else if (value && typeof value === 'object') {
      records = [value];
    }
  } else if (Array.isArray(payload)) {
    records = payload;
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.records)) {
      records = payload.records;
    } else if (Array.isArray(payload.data)) {
      records = payload.data;
    } else {
      records = [payload];
    }
  }

  const normalized = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!ensurePlainObject(record)) continue;

    const out = {};
    for (const [targetField, sourceField] of Object.entries(fieldMap)) {
      if (!sourceField) continue;
      out[targetField] = getByPath(record, sourceField);
    }

    const keyCandidate =
      (keyField && getByPath(record, keyField)) ||
      out.id ||
      out.key ||
      out.symbol ||
      `row:${index}`;

    const recordKey = String(keyCandidate);
    const normalizedRecord = {
      ...out,
      source_path: request.path || '/',
    };

    normalized.push({
      record_key: recordKey,
      payload: record,
      normalized: normalizedRecord,
    });
  }

  return normalized;
}

function inferValueUsd(amount0, amount1, token0Symbol, token1Symbol, bonzoPriceMap) {
  const token0Price = bonzoPriceMap.bySymbol.get(String(token0Symbol || '').toUpperCase()) ?? null;
  const token1Price = bonzoPriceMap.bySymbol.get(String(token1Symbol || '').toUpperCase()) ?? null;

  let total = 0;
  let matched = false;

  const numericAmount0 = parseNumber(amount0, null);
  const numericAmount1 = parseNumber(amount1, null);

  if (token0Price !== null && numericAmount0 !== null) {
    total += Math.abs(numericAmount0) * token0Price;
    matched = true;
  }

  if (token1Price !== null && numericAmount1 !== null) {
    total += Math.abs(numericAmount1) * token1Price;
    matched = true;
  }

  return matched ? total : null;
}

export class DerivedPipelineService {
  constructor({ config, database, fetchImpl = fetch, onEvent = null } = {}) {
    this.config = config;
    this.database = database;
    this.fetchImpl = fetchImpl;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;

    this.realtimeTimer = null;
    this.reconcileTimer = null;
    this.reconcileLastRunKey = '';
    this.realtimeQueued = false;
    this.runningPipelineIds = new Set();

    this.cachedBonzoPriceMap = {
      loadedAtMs: 0,
      map: {
        byEvmAddress: new Map(),
        byHtsAddress: new Map(),
        bySymbol: new Map(),
      },
    };

    this.runtimeStatus = {
      initialized_at: null,
      last_realtime_run_at: null,
      last_reconcile_at: null,
      last_error: null,
    };
  }

  emit(eventType, payload = {}) {
    if (this.onEvent) {
      try {
        this.onEvent(eventType, payload);
      } catch {
        // ignore event handler failures
      }
    }
  }

  async init() {
    if (!this.config.derivedEnabled) {
      return;
    }

    await this.ensureBonzoSystemSource();
    await this.ensureBuiltinPipelines();
    this.startReconcileTicker();

    this.runtimeStatus.initialized_at = nowIso();
  }

  close() {
    if (this.realtimeTimer) {
      clearTimeout(this.realtimeTimer);
      this.realtimeTimer = null;
    }

    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  toExternalSourceRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name || ''),
      slug: String(row.slug || ''),
      description: String(row.description || ''),
      enabled: Number(row.enabled) === 1,
      is_system: Number(row.is_system) === 1,
      preset_key: row.preset_key ? String(row.preset_key) : null,
      base_url: String(row.base_url || ''),
      auth_mode: parseAuthMode(row.auth_mode, 'none'),
      auth_config: parseJsonText(row.auth_config_json, {}),
      request: parseJsonText(row.request_json, {}),
      normalization: parseJsonText(row.normalization_json, {}),
      last_success_at: row.last_success_at || null,
      last_error: row.last_error || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    };
  }

  toExternalSourceRunRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      source_id: String(row.source_id),
      status: String(row.status || 'unknown'),
      trigger_source: row.trigger_source ? String(row.trigger_source) : null,
      http_status: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
      records_fetched: Number(row.records_fetched || 0),
      error: row.error || null,
      metadata: parseJsonText(row.metadata_json, {}),
      started_at: row.started_at || null,
      finished_at: row.finished_at || null,
      created_at: row.created_at || null,
    };
  }

  toPipelineRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name || ''),
      slug: String(row.slug || ''),
      description: String(row.description || ''),
      enabled: Number(row.enabled) === 1,
      realtime_enabled: Number(row.realtime_enabled) === 1,
      is_system: Number(row.is_system) === 1,
      preset_key: row.preset_key ? String(row.preset_key) : null,
      target_table: String(row.target_table || ''),
      schedule: parseJsonText(row.schedule_json, {}),
      spec: parseJsonText(row.spec_json, {}),
      last_run_at: row.last_run_at || null,
      last_run_status: row.last_run_status || null,
      last_error: row.last_error || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      cursor: row.cursor_value || null,
    };
  }

  toPipelineRunRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      pipeline_id: String(row.pipeline_id),
      status: String(row.status || 'unknown'),
      trigger_source: String(row.trigger_source || 'manual'),
      rows_read: Number(row.rows_read || 0),
      rows_written: Number(row.rows_written || 0),
      cursor_before: row.cursor_before || null,
      cursor_after: row.cursor_after || null,
      details: parseJsonText(row.details_json, {}),
      error: row.error || null,
      started_at: row.started_at || null,
      finished_at: row.finished_at || null,
      created_at: row.created_at || null,
    };
  }

  getSourceById(sourceId) {
    const row = this.database.queryOne(`SELECT * FROM external_sources WHERE id = ? LIMIT 1`, [String(sourceId)]);
    return this.toExternalSourceRecord(row);
  }

  getSourceBySlug(slug) {
    const row = this.database.queryOne(`SELECT * FROM external_sources WHERE slug = ? LIMIT 1`, [String(slug)]);
    return this.toExternalSourceRecord(row);
  }

  listSources() {
    const rows = this.database.queryAll(
      `SELECT * FROM external_sources ORDER BY is_system DESC, updated_at DESC, created_at DESC, id ASC`
    );
    return rows.map((row) => this.toExternalSourceRecord(row));
  }

  listSourceRuns(sourceId = null, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    if (sourceId) {
      const rows = this.database.queryAll(
        `SELECT * FROM external_source_runs WHERE source_id = ? ORDER BY started_at DESC, created_at DESC LIMIT ?`,
        [String(sourceId), safeLimit]
      );
      return rows.map((row) => this.toExternalSourceRunRecord(row));
    }

    const rows = this.database.queryAll(
      `SELECT * FROM external_source_runs ORDER BY started_at DESC, created_at DESC LIMIT ?`,
      [safeLimit]
    );
    return rows.map((row) => this.toExternalSourceRunRecord(row));
  }

  createSource(input) {
    const validation = validateExternalSourceDefinition(input, { partial: false });
    if (validation.errors.length > 0) {
      const error = new Error('External source definition is invalid');
      error.code = 'INVALID_DERIVED_SOURCE';
      error.details = { errors: validation.errors };
      throw error;
    }

    const payload = validation.value;
    const sourceId = String(input?.id || crypto.randomUUID());

    this.database.runStatement(
      `INSERT INTO external_sources (
        id,
        name,
        slug,
        description,
        enabled,
        is_system,
        preset_key,
        base_url,
        auth_mode,
        auth_config_json,
        request_json,
        normalization_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        sourceId,
        payload.name,
        payload.slug,
        payload.description || null,
        payload.enabled ? 1 : 0,
        payload.is_system ? 1 : 0,
        payload.preset_key || null,
        payload.base_url,
        payload.auth_mode,
        JSON.stringify(payload.auth_config || {}),
        JSON.stringify(payload.request || {}),
        JSON.stringify(payload.normalization || {}),
      ]
    );

    return this.getSourceById(sourceId);
  }

  updateSource(sourceId, patch = {}) {
    const existing = this.getSourceById(sourceId);
    if (!existing) {
      const error = new Error(`External source not found: ${sourceId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (existing.is_system && patch.is_system === false) {
      const error = new Error('System source ownership cannot be changed');
      error.code = 'INVALID_DERIVED_SOURCE';
      throw error;
    }

    const validation = validateExternalSourceDefinition(patch, { partial: true });
    if (validation.errors.length > 0) {
      const error = new Error('External source update is invalid');
      error.code = 'INVALID_DERIVED_SOURCE';
      error.details = { errors: validation.errors };
      throw error;
    }

    const value = validation.value;
    const next = {
      name: value.name !== undefined ? value.name : existing.name,
      slug: value.slug !== undefined ? value.slug : existing.slug,
      description: value.description !== undefined ? value.description : existing.description,
      enabled: value.enabled !== undefined ? value.enabled : existing.enabled,
      is_system: existing.is_system,
      preset_key: value.preset_key !== undefined ? value.preset_key : existing.preset_key,
      base_url: value.base_url !== undefined ? value.base_url : existing.base_url,
      auth_mode: value.auth_mode !== undefined ? value.auth_mode : existing.auth_mode,
      auth_config: value.auth_config !== undefined ? value.auth_config : existing.auth_config,
      request: value.request !== undefined ? value.request : existing.request,
      normalization: value.normalization !== undefined ? value.normalization : existing.normalization,
    };

    this.database.runStatement(
      `UPDATE external_sources
       SET
         name = ?,
         slug = ?,
         description = ?,
         enabled = ?,
         preset_key = ?,
         base_url = ?,
         auth_mode = ?,
         auth_config_json = ?,
         request_json = ?,
         normalization_json = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        next.name,
        next.slug,
        next.description || null,
        next.enabled ? 1 : 0,
        next.preset_key || null,
        next.base_url,
        next.auth_mode,
        JSON.stringify(next.auth_config || {}),
        JSON.stringify(next.request || {}),
        JSON.stringify(next.normalization || {}),
        String(sourceId),
      ]
    );

    return this.getSourceById(sourceId);
  }

  deleteSource(sourceId) {
    const existing = this.getSourceById(sourceId);
    if (!existing) {
      const error = new Error(`External source not found: ${sourceId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (existing.is_system) {
      const error = new Error('System sources cannot be deleted');
      error.code = 'INVALID_DERIVED_SOURCE';
      throw error;
    }

    this.database.runStatement(`DELETE FROM external_sources WHERE id = ?`, [String(sourceId)]);
    return true;
  }

  getPipelineById(pipelineId) {
    const row = this.database.queryOne(
      `SELECT p.*, c.cursor_value
       FROM derived_pipelines p
       LEFT JOIN derived_pipeline_cursors c ON c.pipeline_id = p.id
       WHERE p.id = ?
       LIMIT 1`,
      [String(pipelineId)]
    );
    return this.toPipelineRecord(row);
  }

  getPipelineBySlug(slug) {
    const row = this.database.queryOne(
      `SELECT p.*, c.cursor_value
       FROM derived_pipelines p
       LEFT JOIN derived_pipeline_cursors c ON c.pipeline_id = p.id
       WHERE p.slug = ?
       LIMIT 1`,
      [String(slug)]
    );
    return this.toPipelineRecord(row);
  }

  listPipelines() {
    const rows = this.database.queryAll(
      `SELECT p.*, c.cursor_value
       FROM derived_pipelines p
       LEFT JOIN derived_pipeline_cursors c ON c.pipeline_id = p.id
       ORDER BY p.is_system DESC, p.updated_at DESC, p.created_at DESC, p.id ASC`
    );
    return rows.map((row) => this.toPipelineRecord(row));
  }

  createUniquePipelineSlug(baseSlug) {
    const seed = slugify(baseSlug) || `pipeline-${Date.now()}`;
    let candidate = seed;
    let suffix = 2;
    while (this.getPipelineBySlug(candidate)) {
      candidate = `${seed}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  listPipelineRuns(pipelineId = null, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    if (pipelineId) {
      const rows = this.database.queryAll(
        `SELECT * FROM derived_pipeline_runs
         WHERE pipeline_id = ?
         ORDER BY started_at DESC, created_at DESC
         LIMIT ?`,
        [String(pipelineId), safeLimit]
      );
      return rows.map((row) => this.toPipelineRunRecord(row));
    }

    const rows = this.database.queryAll(
      `SELECT * FROM derived_pipeline_runs ORDER BY started_at DESC, created_at DESC LIMIT ?`,
      [safeLimit]
    );
    return rows.map((row) => this.toPipelineRunRecord(row));
  }

  createPipeline(input) {
    const validation = validateDerivedPipelineDefinition(input, { partial: false });
    if (validation.errors.length > 0) {
      const error = new Error('Derived pipeline definition is invalid');
      error.code = 'INVALID_DERIVED_PIPELINE';
      error.details = { errors: validation.errors };
      throw error;
    }

    const payload = validation.value;
    const pipelineId = String(input?.id || crypto.randomUUID());

    this.database.runStatement(
      `INSERT INTO derived_pipelines (
        id,
        name,
        slug,
        description,
        enabled,
        realtime_enabled,
        is_system,
        preset_key,
        target_table,
        schedule_json,
        spec_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        pipelineId,
        payload.name,
        payload.slug,
        payload.description || null,
        payload.enabled ? 1 : 0,
        payload.realtime_enabled ? 1 : 0,
        payload.is_system ? 1 : 0,
        payload.preset_key || null,
        payload.target_table,
        JSON.stringify(payload.schedule || {}),
        JSON.stringify(payload.spec || {}),
      ]
    );

    return this.getPipelineById(pipelineId);
  }

  clonePipeline(pipelineId, input = {}) {
    const existing = this.getPipelineById(pipelineId);
    if (!existing) {
      const error = new Error(`Derived pipeline not found: ${pipelineId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    const requestedTargetTable = String(input.target_table || '').trim();
    const defaultTargetTable = `${existing.target_table}_custom`;
    const targetTable = requestedTargetTable || defaultTargetTable;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(targetTable)) {
      const error = new Error('target_table must be a valid SQLite table identifier');
      error.code = 'INVALID_DERIVED_PIPELINE';
      throw error;
    }

    const baseCloneSlug = slugify(input.slug || `${existing.slug}-custom`);
    const cloneSpec = cloneJson(existing.spec || {});
    const cloneSchedule = cloneJson(existing.schedule || {});

    const created = this.createPipeline({
      name: String(input.name || `${existing.name} (Custom)`),
      slug: this.createUniquePipelineSlug(baseCloneSlug),
      description: String(input.description || existing.description || '').trim(),
      enabled: parseBoolean(input.enabled, false),
      realtime_enabled: parseBoolean(input.realtime_enabled, false),
      is_system: false,
      preset_key: existing.preset_key || null,
      target_table: targetTable,
      schedule: cloneSchedule,
      spec: cloneSpec,
    });

    return this.getPipelineById(created.id);
  }

  updatePipeline(pipelineId, patch = {}) {
    const existing = this.getPipelineById(pipelineId);
    if (!existing) {
      const error = new Error(`Derived pipeline not found: ${pipelineId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    const validation = validateDerivedPipelineDefinition(patch, { partial: true });
    if (validation.errors.length > 0) {
      const error = new Error('Derived pipeline update is invalid');
      error.code = 'INVALID_DERIVED_PIPELINE';
      error.details = { errors: validation.errors };
      throw error;
    }

    const value = validation.value;
    const next = {
      name: value.name !== undefined ? value.name : existing.name,
      slug: value.slug !== undefined ? value.slug : existing.slug,
      description: value.description !== undefined ? value.description : existing.description,
      enabled: value.enabled !== undefined ? value.enabled : existing.enabled,
      realtime_enabled: value.realtime_enabled !== undefined ? value.realtime_enabled : existing.realtime_enabled,
      is_system: existing.is_system,
      preset_key: value.preset_key !== undefined ? value.preset_key : existing.preset_key,
      target_table: value.target_table !== undefined ? value.target_table : existing.target_table,
      schedule: value.schedule !== undefined ? value.schedule : existing.schedule,
      spec: value.spec !== undefined ? value.spec : existing.spec,
    };

    this.database.runStatement(
      `UPDATE derived_pipelines
       SET
         name = ?,
         slug = ?,
         description = ?,
         enabled = ?,
         realtime_enabled = ?,
         preset_key = ?,
         target_table = ?,
         schedule_json = ?,
         spec_json = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        next.name,
        next.slug,
        next.description || null,
        next.enabled ? 1 : 0,
        next.realtime_enabled ? 1 : 0,
        next.preset_key || null,
        next.target_table,
        JSON.stringify(next.schedule || {}),
        JSON.stringify(next.spec || {}),
        String(pipelineId),
      ]
    );

    return this.getPipelineById(pipelineId);
  }

  deletePipeline(pipelineId) {
    const existing = this.getPipelineById(pipelineId);
    if (!existing) {
      const error = new Error(`Derived pipeline not found: ${pipelineId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (existing.is_system) {
      const error = new Error('System pipelines cannot be deleted');
      error.code = 'INVALID_DERIVED_PIPELINE';
      throw error;
    }

    this.database.runStatement(`DELETE FROM derived_pipelines WHERE id = ?`, [String(pipelineId)]);
    return true;
  }

  getPipelineCursor(pipelineId) {
    const row = this.database.queryOne(`SELECT cursor_value FROM derived_pipeline_cursors WHERE pipeline_id = ? LIMIT 1`, [
      String(pipelineId),
    ]);
    return row?.cursor_value == null ? null : String(row.cursor_value);
  }

  setPipelineCursor(pipelineId, cursorValue) {
    this.database.runStatement(
      `INSERT INTO derived_pipeline_cursors (pipeline_id, cursor_value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(pipeline_id)
       DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = datetime('now')`,
      [String(pipelineId), cursorValue === null || cursorValue === undefined ? null : String(cursorValue)]
    );
  }

  listPipelineContractCursors(pipelineId, contractIds = []) {
    const normalizedContractIds = Array.isArray(contractIds)
      ? contractIds.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    if (normalizedContractIds.length === 0) {
      const rows = this.database.queryAll(
        `SELECT contract_id, cursor_log_id
           FROM derived_pipeline_contract_cursors
          WHERE pipeline_id = ?`,
        [String(pipelineId)]
      );
      return new Map(
        rows.map((row) => [
          String(row.contract_id),
          Number.isFinite(Number(row.cursor_log_id)) ? Number(row.cursor_log_id) : 0,
        ])
      );
    }

    const placeholders = normalizedContractIds.map(() => '?').join(', ');
    const rows = this.database.queryAll(
      `SELECT contract_id, cursor_log_id
         FROM derived_pipeline_contract_cursors
        WHERE pipeline_id = ?
          AND contract_id IN (${placeholders})`,
      [String(pipelineId), ...normalizedContractIds]
    );
    return new Map(
      rows.map((row) => [
        String(row.contract_id),
        Number.isFinite(Number(row.cursor_log_id)) ? Number(row.cursor_log_id) : 0,
      ])
    );
  }

  setPipelineContractCursors(pipelineId, cursorEntries = []) {
    if (!Array.isArray(cursorEntries) || cursorEntries.length === 0) return;
    const db = this.database.db;
    const stmt = db.prepare(
      `INSERT INTO derived_pipeline_contract_cursors (pipeline_id, contract_id, cursor_log_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(pipeline_id, contract_id)
       DO UPDATE SET cursor_log_id = excluded.cursor_log_id, updated_at = datetime('now')`
    );

    const tx = db.transaction((items) => {
      for (const item of items) {
        const contractId = String(item?.contract_id || '').trim();
        if (!contractId) continue;
        const cursor = Number(item?.cursor_log_id);
        stmt.run(
          String(pipelineId),
          contractId,
          Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0
        );
      }
    });

    tx.immediate(cursorEntries);
    this.database.invalidateMetricsCache();
    this.database.scheduleSave();
  }

  clearPipelineContractCursors(pipelineId) {
    this.database.runStatement(`DELETE FROM derived_pipeline_contract_cursors WHERE pipeline_id = ?`, [String(pipelineId)]);
  }

  async fetchJsonWithRetry(url, init = {}, timeoutMs = null) {
    const retries = Math.max(0, Number(this.config.externalSourceMaxRetries) || 0);
    const effectiveTimeoutMs = Math.max(500, Number(timeoutMs || this.config.externalSourceTimeoutMs) || 8000);

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error(`timeout after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryable = [429, 500, 502, 503, 504].includes(response.status);
          const responseText = await response.text();
          const error = new Error(responseText || `HTTP ${response.status}`);
          error.status = response.status;
          if (!retryable || attempt >= retries) {
            throw error;
          }
          lastError = error;
          await sleep(Math.min(4000, 500 * 2 ** attempt));
          continue;
        }

        const payload = await response.json();
        return {
          payload,
          status: response.status,
        };
      } catch (error) {
        lastError = error;
        if (attempt >= retries) {
          throw error;
        }
        await sleep(Math.min(4000, 500 * 2 ** attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error('External source request failed');
  }

  async runSource(sourceId, { triggerSource = 'manual', persist = true, maxRecords = 5000 } = {}) {
    const source = this.getSourceById(sourceId);
    if (!source) {
      const error = new Error(`External source not found: ${sourceId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    const runId = crypto.randomUUID();
    const startedAt = nowIso();

    this.database.runStatement(
      `INSERT INTO external_source_runs (
        id,
        source_id,
        status,
        trigger_source,
        http_status,
        records_fetched,
        error,
        metadata_json,
        started_at,
        finished_at,
        created_at
      ) VALUES (?, ?, 'running', ?, NULL, 0, NULL, '{}', ?, NULL, datetime('now'))`,
      [runId, source.id, String(triggerSource || 'manual'), startedAt]
    );

    this.emit('derived_source_run_started', {
      run_id: runId,
      source_id: source.id,
      source_slug: source.slug,
      trigger_source: triggerSource,
      started_at: startedAt,
    });

    try {
      const request = ensurePlainObject(source.request) ? source.request : {};
      const headers = applySourceAuthHeaders(source, {
        Accept: 'application/json',
        ...(ensurePlainObject(request.headers) ? request.headers : {}),
      });
      const method = parseHttpMethod(request.method, 'GET');

      if (method !== 'GET' && !Object.prototype.hasOwnProperty.call(headers, 'Content-Type')) {
        headers['Content-Type'] = 'application/json';
      }

      const fetchInit = {
        method,
        headers,
      };

      if (method !== 'GET' && request.body !== null && request.body !== undefined) {
        fetchInit.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      }

      const requestUrl = buildSourceRequestUrl(source);
      const fetchResult = await this.fetchJsonWithRetry(requestUrl, fetchInit, request.timeout_ms || null);
      const normalizedRecords = normalizeSourceRecords(source, fetchResult.payload).slice(0, Math.max(1, Number(maxRecords) || 5000));

      if (persist && normalizedRecords.length > 0) {
        const db = this.database.db;
        const upsertStmt = db.prepare(
          `INSERT INTO external_source_records (
            source_id,
            run_id,
            record_key,
            payload_json,
            normalized_json,
            observed_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(source_id, record_key)
          DO UPDATE SET
            run_id = excluded.run_id,
            payload_json = excluded.payload_json,
            normalized_json = excluded.normalized_json,
            observed_at = excluded.observed_at`
        );

        const observedAt = nowIso();
        const upsertMany = db.transaction((items) => {
          for (const item of items) {
            upsertStmt.run(
              source.id,
              runId,
              String(item.record_key),
              JSON.stringify(item.payload || {}),
              JSON.stringify(item.normalized || {}),
              observedAt
            );
          }
        });
        upsertMany.immediate(normalizedRecords);
        this.database.invalidateMetricsCache();
        this.database.scheduleSave();
      }

      const finishedAt = nowIso();
      const runMetadata = {
        source_slug: source.slug,
        request_url: buildSourceRequestUrl(source),
      };

      this.database.runStatement(
        `UPDATE external_source_runs
         SET
           status = 'success',
           http_status = ?,
           records_fetched = ?,
           error = NULL,
           metadata_json = ?,
           finished_at = ?
         WHERE id = ?`,
        [fetchResult.status, normalizedRecords.length, JSON.stringify(runMetadata), finishedAt, runId]
      );

      this.database.runStatement(
        `UPDATE external_sources
         SET
           last_success_at = ?,
           last_error = NULL,
           updated_at = datetime('now')
         WHERE id = ?`,
        [finishedAt, source.id]
      );

      this.emit('derived_source_run_finished', {
        run_id: runId,
        source_id: source.id,
        source_slug: source.slug,
        records_fetched: normalizedRecords.length,
        finished_at: finishedAt,
      });

      return {
        run: this.toExternalSourceRunRecord(
          this.database.queryOne(`SELECT * FROM external_source_runs WHERE id = ? LIMIT 1`, [runId])
        ),
        source: this.getSourceById(source.id),
        sample_records: normalizedRecords.slice(0, 5).map((entry) => entry.normalized),
        records_fetched: normalizedRecords.length,
      };
    } catch (error) {
      const finishedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      const httpStatus = Number(error?.status) || null;

      this.database.runStatement(
        `UPDATE external_source_runs
         SET
           status = 'failed',
           http_status = ?,
           error = ?,
           finished_at = ?
         WHERE id = ?`,
        [httpStatus, message, finishedAt, runId]
      );

      this.database.runStatement(
        `UPDATE external_sources
         SET
           last_error = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
        [message, source.id]
      );

      this.emit('derived_source_run_failed', {
        run_id: runId,
        source_id: source.id,
        source_slug: source.slug,
        error: message,
        finished_at: finishedAt,
      });

      throw error;
    }
  }

  async ensureBonzoSystemSource() {
    const existing = this.getSourceBySlug(BUILTIN_BONZO_SOURCE_SLUG);
    const desired = defaultBonzoSourceDefinition(this.config.bonzoApiBaseUrl);

    if (!existing) {
      this.createSource(desired);
      return;
    }

    this.updateSource(existing.id, {
      name: desired.name,
      slug: desired.slug,
      description: desired.description,
      enabled: true,
      base_url: desired.base_url,
      auth_mode: desired.auth_mode,
      auth_config: desired.auth_config,
      request: desired.request,
      normalization: desired.normalization,
      preset_key: desired.preset_key,
      is_system: true,
    });
  }

  async ensureBuiltinPipelines() {
    const existingBySlug = new Map(this.listPipelines().map((pipeline) => [pipeline.slug, pipeline]));

    for (const builtin of defaultBuiltinPipelines()) {
      const existing = existingBySlug.get(builtin.slug);
      if (!existing) {
        this.createPipeline(builtin);
        continue;
      }

      this.updatePipeline(existing.id, {
        name: builtin.name,
        slug: builtin.slug,
        description: builtin.description,
        enabled: builtin.enabled,
        realtime_enabled: builtin.realtime_enabled,
        preset_key: builtin.preset_key,
        target_table: builtin.target_table,
        schedule: builtin.schedule,
        spec: builtin.spec,
      });
    }
  }

  startReconcileTicker() {
    if (!this.config.derivedEnabled) return;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
    }

    this.reconcileTimer = setInterval(() => {
      this.runScheduledReconcile().catch((error) => {
        this.runtimeStatus.last_error = error instanceof Error ? error.message : String(error);
      });
    }, 60_000);

    if (typeof this.reconcileTimer.unref === 'function') {
      this.reconcileTimer.unref();
    }
  }

  async runScheduledReconcile() {
    if (!this.config.derivedEnabled) return;
    const cronExpr = String(this.config.derivedReconcileCron || '').trim();
    const now = Date.now();
    if (!cronMatchesNow(cronExpr, now, this.reconcileLastRunKey)) {
      return;
    }

    const date = new Date(now);
    this.reconcileLastRunKey = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}-${date.getHours()}-${date.getMinutes()}`;

    await this.runRealtimeBuiltinPipelines({ triggerSource: 'reconcile', reconcile: true });
    this.runtimeStatus.last_reconcile_at = nowIso();
  }

  queueRealtimeIncrementalRun(reason = 'indexer_event') {
    if (!this.config.derivedEnabled) return;
    if (this.realtimeQueued) return;

    this.realtimeQueued = true;
    this.realtimeTimer = setTimeout(() => {
      this.realtimeQueued = false;
      this.runRealtimeBuiltinPipelines({ triggerSource: reason, reconcile: false }).catch((error) => {
        this.runtimeStatus.last_error = error instanceof Error ? error.message : String(error);
      });
    }, 1200);

    if (typeof this.realtimeTimer.unref === 'function') {
      this.realtimeTimer.unref();
    }
  }

  onIndexerEvent(eventName, payload = {}) {
    if (!this.config.derivedEnabled) return;
    if (!shouldTriggerDerivedIncremental(eventName, payload)) return;
    this.queueRealtimeIncrementalRun(`indexer:${eventName}`);
  }

  async runRealtimeBuiltinPipelines({ triggerSource = 'realtime', reconcile = false } = {}) {
    const pipelines = this.listPipelines().filter((pipeline) => {
      if (!pipeline.enabled) return false;
      if (!pipeline.realtime_enabled && triggerSource !== 'reconcile') return false;
      return pipeline.spec?.kind === 'builtin';
    });

    for (const pipeline of pipelines) {
      try {
        await this.runPipelineById(pipeline.id, {
          triggerSource,
          reconcile,
        });
      } catch (error) {
        this.runtimeStatus.last_error = error instanceof Error ? error.message : String(error);
      }
    }

    this.runtimeStatus.last_realtime_run_at = nowIso();
  }

  async ensureTableShape(tableName, targetColumns = [], keyColumns = []) {
    if (!Array.isArray(targetColumns) || targetColumns.length === 0) {
      return;
    }

    const tableExists = Boolean(
      this.database.queryOne(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
        [String(tableName)]
      )?.name
    );

    if (!tableExists) {
      const columnSql = targetColumns
        .map((column) => {
          const constraints = [];
          if (column.primary_key) {
            constraints.push('PRIMARY KEY');
          }
          return `${escapeIdentifier(column.name)} ${toSqlColumnType(column.type)} ${constraints.join(' ')}`.trim();
        })
        .join(', ');

      this.database.runStatement(`CREATE TABLE IF NOT EXISTS ${escapeIdentifier(tableName)} (${columnSql})`);

      if (Array.isArray(keyColumns) && keyColumns.length > 1) {
        this.database.runStatement(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${escapeIdentifier(`uq_${tableName}_${keyColumns.join('_')}`)} ON ${escapeIdentifier(tableName)} (${keyColumns
            .map((column) => escapeIdentifier(column))
            .join(', ')})`
        );
      }
      return;
    }

    const existingColumns = new Set(
      this.database
        .queryAll(`PRAGMA table_info(${escapeIdentifier(tableName)})`)
        .map((column) => String(column.name || '').trim())
        .filter(Boolean)
    );

    for (const column of targetColumns) {
      if (existingColumns.has(column.name)) continue;
      this.database.runStatement(
        `ALTER TABLE ${escapeIdentifier(tableName)} ADD COLUMN ${escapeIdentifier(column.name)} ${toSqlColumnType(column.type)}`
      );
    }
  }

  async getBonzoPriceMap({ forceRefresh = false } = {}) {
    const nowMs = Date.now();
    const cacheAgeMs = nowMs - this.cachedBonzoPriceMap.loadedAtMs;
    if (!forceRefresh && cacheAgeMs < 60_000 && this.cachedBonzoPriceMap.loadedAtMs > 0) {
      return this.cachedBonzoPriceMap.map;
    }

    const source = this.getSourceBySlug(BUILTIN_BONZO_SOURCE_SLUG);
    if (!source) {
      return {
        byEvmAddress: new Map(),
        byHtsAddress: new Map(),
        bySymbol: new Map(),
      };
    }

    const latestObserved = this.database.queryOne(
      `SELECT MAX(observed_at) AS observed_at FROM external_source_records WHERE source_id = ?`,
      [source.id]
    )?.observed_at;

    const shouldRefresh =
      forceRefresh ||
      !latestObserved ||
      Date.now() - Date.parse(String(latestObserved || '')) > 3 * 60_000;

    if (shouldRefresh) {
      try {
        await this.runSource(source.id, {
          triggerSource: 'enrichment_refresh',
          persist: true,
          maxRecords: 8000,
        });
      } catch {
        // use stale cache/records if refresh fails
      }
    }

    const rows = this.database.queryAll(
      `SELECT normalized_json FROM external_source_records WHERE source_id = ? ORDER BY observed_at DESC, id DESC LIMIT 8000`,
      [source.id]
    );

    const byEvmAddress = new Map();
    const byHtsAddress = new Map();
    const bySymbol = new Map();

    for (const row of rows) {
      const normalized = parseJsonText(row.normalized_json, {});
      const priceUsd = parseNumber(normalized.price_usd, parseNumber(normalized.price_usd_display, null));
      if (priceUsd === null) continue;

      const evmAddress = normalizeAddress(normalized.evm_address);
      const htsAddress = normalizeAddress(normalized.hts_address);
      const symbol = String(normalized.symbol || '').trim().toUpperCase() || null;

      if (evmAddress) byEvmAddress.set(evmAddress, priceUsd);
      if (htsAddress) byHtsAddress.set(htsAddress, priceUsd);
      if (symbol) bySymbol.set(symbol, priceUsd);
    }

    this.cachedBonzoPriceMap = {
      loadedAtMs: Date.now(),
      map: {
        byEvmAddress,
        byHtsAddress,
        bySymbol,
      },
    };

    return this.cachedBonzoPriceMap.map;
  }

  createPipelineRunRecord(run) {
    this.database.runStatement(
      `INSERT INTO derived_pipeline_runs (
        id,
        pipeline_id,
        status,
        trigger_source,
        rows_read,
        rows_written,
        cursor_before,
        cursor_after,
        details_json,
        error,
        started_at,
        finished_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        run.id,
        run.pipeline_id,
        run.status,
        run.trigger_source,
        Number(run.rows_read || 0),
        Number(run.rows_written || 0),
        run.cursor_before || null,
        run.cursor_after || null,
        JSON.stringify(run.details || {}),
        run.error || null,
        run.started_at,
        run.finished_at || null,
      ]
    );
  }

  updatePipelineRunRecord(runId, patch = {}) {
    const existing = this.database.queryOne(`SELECT * FROM derived_pipeline_runs WHERE id = ? LIMIT 1`, [runId]);
    if (!existing) return;

    const next = {
      status: patch.status !== undefined ? patch.status : existing.status,
      rows_read: patch.rows_read !== undefined ? patch.rows_read : existing.rows_read,
      rows_written: patch.rows_written !== undefined ? patch.rows_written : existing.rows_written,
      cursor_before: patch.cursor_before !== undefined ? patch.cursor_before : existing.cursor_before,
      cursor_after: patch.cursor_after !== undefined ? patch.cursor_after : existing.cursor_after,
      details_json:
        patch.details !== undefined
          ? JSON.stringify(patch.details || {})
          : existing.details_json || '{}',
      error: patch.error !== undefined ? patch.error : existing.error,
      finished_at: patch.finished_at !== undefined ? patch.finished_at : existing.finished_at,
    };

    this.database.runStatement(
      `UPDATE derived_pipeline_runs
       SET
         status = ?,
         rows_read = ?,
         rows_written = ?,
         cursor_before = ?,
         cursor_after = ?,
         details_json = ?,
         error = ?,
         finished_at = ?
       WHERE id = ?`,
      [
        next.status,
        Number(next.rows_read || 0),
        Number(next.rows_written || 0),
        next.cursor_before || null,
        next.cursor_after || null,
        next.details_json,
        next.error || null,
        next.finished_at || null,
        runId,
      ]
    );
  }

  markPipelineLastRun(pipelineId, { status, error = null }) {
    this.database.runStatement(
      `UPDATE derived_pipelines
       SET
         last_run_at = ?,
         last_run_status = ?,
         last_error = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [nowIso(), String(status || 'unknown'), error ? String(error) : null, String(pipelineId)]
    );
  }

  async runPipelineById(pipelineId, options = {}) {
    const pipeline = this.getPipelineById(pipelineId);
    if (!pipeline) {
      const error = new Error(`Derived pipeline not found: ${pipelineId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }
    return this.runPipeline(pipeline, options);
  }

  async runAllPipelines(options = {}) {
    const triggerSource = String(options.triggerSource || 'manual_run_all');
    const reconcile = options.reconcile === true;
    const includeDisabled = options.includeDisabled === true;
    const limit = Math.max(1, Math.min(Number(options.limit) || this.config.derivedBatchSize || 2000, 20000));

    const startedAt = nowIso();
    const pipelines = this.listPipelines().filter((pipeline) => includeDisabled || pipeline.enabled);
    const results = [];

    for (const pipeline of pipelines) {
      try {
        const execution = await this.runPipelineById(pipeline.id, {
          triggerSource,
          reconcile,
          limit,
          preview: false,
        });
        results.push({
          pipeline_id: pipeline.id,
          pipeline_slug: pipeline.slug,
          status: execution.run?.status || 'success',
          run_id: execution.run?.id || null,
          rows_read: Number(execution.run?.rows_read || 0),
          rows_written: Number(execution.run?.rows_written || 0),
          error: null,
        });
      } catch (error) {
        results.push({
          pipeline_id: pipeline.id,
          pipeline_slug: pipeline.slug,
          status: 'failed',
          run_id: null,
          rows_read: 0,
          rows_written: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const successCount = results.filter((item) => item.status === 'success').length;
    const failedCount = results.filter((item) => item.status !== 'success').length;

    return {
      trigger_source: triggerSource,
      reconcile,
      limit,
      started_at: startedAt,
      finished_at: nowIso(),
      total: results.length,
      success_count: successCount,
      failed_count: failedCount,
      results,
    };
  }

  async runPipelinePreview(pipelineId, options = {}) {
    const pipeline = this.getPipelineById(pipelineId);
    if (!pipeline) {
      const error = new Error(`Derived pipeline not found: ${pipelineId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    const limit = Math.max(1, Math.min(Number(options.limit) || 25, 500));
    return this.runPipeline(pipeline, {
      triggerSource: 'preview',
      preview: true,
      limit,
      reconcile: false,
    });
  }

  async runPipeline(pipeline, options = {}) {
    const triggerSource = String(options.triggerSource || 'manual');
    const preview = options.preview === true;
    const limit = Math.max(1, Math.min(Number(options.limit) || this.config.derivedBatchSize || 2000, 20000));
    const reconcile = options.reconcile === true;

    if (!preview && !pipeline.enabled) {
      const error = new Error(`Pipeline is disabled: ${pipeline.slug}`);
      error.code = 'PIPELINE_DISABLED';
      throw error;
    }

    if (this.runningPipelineIds.has(pipeline.id)) {
      const error = new Error(`Pipeline is already running: ${pipeline.slug}`);
      error.code = 'PIPELINE_RUNNING';
      throw error;
    }

    this.runningPipelineIds.add(pipeline.id);
    const startedAt = nowIso();
    const runId = crypto.randomUUID();
    const cursorBefore = this.getPipelineCursor(pipeline.id);

    this.createPipelineRunRecord({
      id: runId,
      pipeline_id: pipeline.id,
      status: 'running',
      trigger_source: triggerSource,
      rows_read: 0,
      rows_written: 0,
      cursor_before: cursorBefore,
      cursor_after: cursorBefore,
      details: {
        preview,
        reconcile,
      },
      error: null,
      started_at: startedAt,
      finished_at: null,
    });

    this.emit('derived_pipeline_run_started', {
      run_id: runId,
      pipeline_id: pipeline.id,
      pipeline_slug: pipeline.slug,
      trigger_source: triggerSource,
      preview,
      reconcile,
      started_at: startedAt,
    });

    try {
      let execution;
      if (pipeline.spec?.kind === 'builtin') {
        execution = await this.executeBuiltinPipeline(pipeline, {
          cursorBefore,
          limit,
          preview,
          reconcile,
        });
      } else {
        execution = await this.executeSqlTransformPipeline(pipeline, {
          cursorBefore,
          limit,
          preview,
        });
      }

      const cursorAfter = execution.cursorAfter !== undefined ? execution.cursorAfter : cursorBefore;
      if (!preview && cursorAfter !== undefined) {
        this.setPipelineCursor(pipeline.id, cursorAfter);
      }

      const finishedAt = nowIso();
      this.updatePipelineRunRecord(runId, {
        status: 'success',
        rows_read: execution.rowsRead || 0,
        rows_written: execution.rowsWritten || 0,
        cursor_before: cursorBefore,
        cursor_after: cursorAfter,
        details: execution.details || {},
        error: null,
        finished_at: finishedAt,
      });

      if (!preview) {
        this.markPipelineLastRun(pipeline.id, { status: 'success', error: null });
      }

      this.emit('derived_pipeline_run_finished', {
        run_id: runId,
        pipeline_id: pipeline.id,
        pipeline_slug: pipeline.slug,
        rows_read: execution.rowsRead || 0,
        rows_written: execution.rowsWritten || 0,
        cursor_before: cursorBefore,
        cursor_after: cursorAfter,
        finished_at: finishedAt,
        preview,
        reconcile,
      });

      return {
        run: this.toPipelineRunRecord(this.database.queryOne(`SELECT * FROM derived_pipeline_runs WHERE id = ? LIMIT 1`, [runId])),
        pipeline: this.getPipelineById(pipeline.id),
        preview_rows: execution.previewRows || [],
      };
    } catch (error) {
      const finishedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);

      this.updatePipelineRunRecord(runId, {
        status: 'failed',
        error: message,
        finished_at: finishedAt,
      });

      if (!preview) {
        this.markPipelineLastRun(pipeline.id, { status: 'failed', error: message });
      }

      this.emit('derived_pipeline_run_failed', {
        run_id: runId,
        pipeline_id: pipeline.id,
        pipeline_slug: pipeline.slug,
        error: message,
        finished_at: finishedAt,
        preview,
        reconcile,
      });

      throw error;
    } finally {
      this.runningPipelineIds.delete(pipeline.id);
    }
  }

  async executeBuiltinPipeline(pipeline, { cursorBefore, limit, preview, reconcile }) {
    const builtinKey = String(pipeline.spec?.builtin_key || pipeline.preset_key || '').trim();
    if (!builtinKey || !BUILTIN_PIPELINE_KEYS.has(builtinKey)) {
      throw new Error(`Unsupported builtin pipeline: ${builtinKey}`);
    }

    if (!preview) {
      const shape = getBuiltinTableShape(builtinKey);
      if (shape.columns.length > 0) {
        await this.ensureTableShape(pipeline.target_table, shape.columns, shape.keyColumns);
      }
    }

    if (builtinKey === 'clmm_pool_snapshots') {
      return this.runBuiltinClmmPoolSnapshots(pipeline, { cursorBefore, limit, preview, reconcile });
    }

    if (builtinKey === 'clmm_positions') {
      return this.runBuiltinClmmPositions(pipeline, { cursorBefore, limit, preview, reconcile });
    }

    if (builtinKey === 'vault_actions_decoded') {
      return this.runBuiltinVaultActionsDecoded(pipeline, { cursorBefore, limit, preview, reconcile });
    }

    if (builtinKey === 'vault_strategy_state') {
      return this.runBuiltinVaultStrategyState(pipeline, { cursorBefore, limit, preview, reconcile });
    }

    if (builtinKey === 'price_volatility_snapshots') {
      return this.runBuiltinPriceVolatilitySnapshots(pipeline, { cursorBefore, limit, preview, reconcile });
    }

    if (builtinKey === 'clmm_agent_state') {
      return {
        rowsRead: 0,
        rowsWritten: 0,
        cursorAfter: cursorBefore,
        previewRows: [],
        details: {
          mode: 'schema_only',
          note: 'clmm_agent_state is intentionally not auto-populated in v1.',
        },
      };
    }

    throw new Error(`Unsupported builtin pipeline: ${builtinKey}`);
  }

  getBuiltinContractFilterSpec(builtinKey) {
    return BUILTIN_PIPELINE_CONTRACT_FILTERS[String(builtinKey || '').trim()] || null;
  }

  listSourceContractRowsForBuiltin(pipeline, builtinKey) {
    const filter = this.getBuiltinContractFilterSpec(builtinKey);
    if (!filter) {
      return [];
    }

    const allContracts = this.database.queryAll(
      `SELECT contract_id, category, evm_address, canonical_name, name
         FROM contracts
        WHERE contract_id IS NOT NULL`
    );

    const filtered = allContracts.filter((row) => categoryMatchesFilter(row?.category, filter));

    const explicitContractIds = Array.isArray(pipeline?.spec?.source_contract_ids)
      ? pipeline.spec.source_contract_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    if (explicitContractIds.length === 0) {
      return filtered.sort((left, right) => String(left.contract_id).localeCompare(String(right.contract_id)));
    }

    const allowed = new Set(explicitContractIds);
    const scoped = filtered.filter((row) => allowed.has(String(row.contract_id)));
    if (scoped.length > 0) {
      return scoped.sort((left, right) => String(left.contract_id).localeCompare(String(right.contract_id)));
    }

    const explicitRows = allContracts.filter((row) => allowed.has(String(row.contract_id)));
    return explicitRows.sort((left, right) => String(left.contract_id).localeCompare(String(right.contract_id)));
  }

  listSourceContractIdsForBuiltin(pipeline, builtinKey) {
    return this.listSourceContractRowsForBuiltin(pipeline, builtinKey).map((row) => String(row.contract_id));
  }

  queryMaxLogIdByContractIds(contractIds = []) {
    const ids = Array.isArray(contractIds) ? contractIds.map((value) => String(value || '').trim()).filter(Boolean) : [];
    if (ids.length === 0) return new Map();

    const chunkSize = 300;
    const out = new Map();

    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = this.database.queryAll(
        `SELECT contract_id, MAX(id) AS max_log_id
           FROM contract_logs
          WHERE contract_id IN (${placeholders})
          GROUP BY contract_id`,
        chunk
      );
      for (const row of rows) {
        const contractId = String(row?.contract_id || '').trim();
        if (!contractId) continue;
        out.set(contractId, Number(row?.max_log_id || 0));
      }
    }

    return out;
  }

  resolveCursorStartFromReconcile(tableName, cursorBefore, reconcileWindowRows) {
    if (!tableName) {
      return parseNumber(cursorBefore, 0) || 0;
    }

    const maxRow = this.database.queryOne(`SELECT MAX(id) AS max_id FROM ${escapeIdentifier(tableName)}`);
    const maxId = Number(maxRow?.max_id || 0);
    if (!Number.isFinite(maxId) || maxId <= 0) {
      return 0;
    }

    const windowRows = Math.max(1000, Number(reconcileWindowRows) || 250000);
    return Math.max(0, maxId - windowRows);
  }

  resolveContractCursorStartFromReconcile(contractId, cursorBefore, reconcileWindowRows) {
    const normalizedId = String(contractId || '').trim();
    if (!normalizedId) {
      return Math.max(0, Number(cursorBefore || 0));
    }

    const maxRow = this.database.queryOne(`SELECT MAX(id) AS max_id FROM contract_logs WHERE contract_id = ?`, [normalizedId]);
    const maxId = Number(maxRow?.max_id || 0);
    if (!Number.isFinite(maxId) || maxId <= 0) {
      return 0;
    }

    const windowRows = Math.max(1000, Number(reconcileWindowRows) || 250000);
    return Math.max(0, maxId - windowRows);
  }

  queryContractLogBatch(
    cursorBefore,
    {
      limit,
      reconcile = false,
      reconcileWindowRows = 250000,
      eventNames = null,
      contractIds = null,
      categories = null,
      excludeCategories = null,
      startCursorOverride = null,
    } = {}
  ) {
    const startCursor = startCursorOverride !== null && startCursorOverride !== undefined
      ? Math.max(0, Number(startCursorOverride || 0))
      : reconcile
        ? this.resolveCursorStartFromReconcile('contract_logs', cursorBefore, reconcileWindowRows)
        : Math.max(0, Number(cursorBefore || 0));

    const safeLimit = Math.max(1, Math.min(Number(limit) || this.config.derivedBatchSize || 2000, 20000));

    let sql = `
      SELECT
        l.id AS log_id,
        l.contract_id,
        l.tx_hash,
        l.event_name,
        l.topic0,
        l.topic1,
        l.topic2,
        l.topic3,
        l.data,
        l.block_number,
        l.log_index,
        l.timestamp,
        c.evm_address,
        c.category,
        c.canonical_name,
        c.asset
      FROM contract_logs l
      LEFT JOIN contracts c ON c.contract_id = l.contract_id
      WHERE l.id > ?`;

    const params = [startCursor];

    if (Array.isArray(eventNames) && eventNames.length > 0) {
      sql += ` AND l.event_name IN (${eventNames.map(() => '?').join(', ')})`;
      params.push(...eventNames);
    }

    if (Array.isArray(contractIds) && contractIds.length > 0) {
      const normalizedContractIds = contractIds.map((value) => String(value || '').trim()).filter(Boolean);
      if (normalizedContractIds.length > 0) {
        sql += ` AND l.contract_id IN (${normalizedContractIds.map(() => '?').join(', ')})`;
        params.push(...normalizedContractIds);
      }
    }

    if (Array.isArray(categories) && categories.length > 0) {
      const normalizedCategories = categories.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      if (normalizedCategories.length > 0) {
        sql += ` AND lower(coalesce(c.category, '')) IN (${normalizedCategories.map(() => '?').join(', ')})`;
        params.push(...normalizedCategories);
      }
    }

    if (Array.isArray(excludeCategories) && excludeCategories.length > 0) {
      const normalizedExcluded = excludeCategories.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      if (normalizedExcluded.length > 0) {
        sql += ` AND lower(coalesce(c.category, '')) NOT IN (${normalizedExcluded.map(() => '?').join(', ')})`;
        params.push(...normalizedExcluded);
      }
    }

    sql += ` ORDER BY l.id ASC LIMIT ?`;
    params.push(safeLimit);

    const rows = this.database.queryAll(sql, params);
    const cursorAfter = rows.length > 0 ? Number(rows[rows.length - 1].log_id) : startCursor;

    return {
      rows,
      cursorAfter,
      startCursor,
    };
  }

  queryPipelineContractLogsFair(
    pipeline,
    builtinKey,
    {
      limit,
      eventNames = null,
      reconcile = false,
      reconcileWindowRows = 250000,
      perContractLimit = null,
      preview = false,
    } = {}
  ) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || this.config.derivedBatchSize || 2000, 20000));

    const contractRows = this.listSourceContractRowsForBuiltin(pipeline, builtinKey);
    const contractIds = contractRows.map((row) => String(row.contract_id));
    if (contractIds.length === 0) {
      const fallbackCursor = Math.max(0, Number(this.getPipelineCursor(pipeline.id) || 0));
      return {
        rows: [],
        rowsRead: 0,
        cursorAfter: fallbackCursor,
        contractCount: 0,
        touchedContracts: 0,
        pendingContracts: 0,
        sourceMaxLogId: fallbackCursor,
      };
    }

    const defaultPerContractLimit = Math.max(1, Math.floor(safeLimit / Math.max(1, Math.min(contractIds.length, 8))));
    const safePerContractLimit = Math.max(
      1,
      Math.min(Number(perContractLimit || pipeline?.spec?.per_contract_limit) || defaultPerContractLimit, safeLimit)
    );

    const existingCursorMap = this.listPipelineContractCursors(pipeline.id, contractIds);
    const sourceMaxByContract = this.queryMaxLogIdByContractIds(contractIds);

    const cursorByContract = new Map();
    for (const contractId of contractIds) {
      const existingCursor = Math.max(0, Number(existingCursorMap.get(contractId) || 0));
      const startCursor = reconcile
        ? this.resolveContractCursorStartFromReconcile(contractId, existingCursor, reconcileWindowRows)
        : existingCursor;
      cursorByContract.set(contractId, startCursor);
    }

    const rows = [];
    const touchedContractIds = new Set();
    let remaining = safeLimit;

    while (remaining > 0) {
      const ordering = Array.from(contractIds).sort((left, right) => {
        const leftCursor = Number(cursorByContract.get(left) || 0);
        const rightCursor = Number(cursorByContract.get(right) || 0);
        if (leftCursor !== rightCursor) return leftCursor - rightCursor;
        return left.localeCompare(right);
      });

      let progressed = false;

      for (const contractId of ordering) {
        if (remaining <= 0) break;
        const cursor = Math.max(0, Number(cursorByContract.get(contractId) || 0));
        const sourceMax = Math.max(0, Number(sourceMaxByContract.get(contractId) || 0));
        if (!reconcile && cursor >= sourceMax) {
          continue;
        }
        const batchLimit = Math.min(remaining, safePerContractLimit);
        const batch = this.queryContractLogBatch(cursor, {
          limit: batchLimit,
          reconcile: false,
          eventNames,
          contractIds: [contractId],
          startCursorOverride: cursor,
        });

        if (batch.rows.length === 0) {
          continue;
        }

        progressed = true;
        touchedContractIds.add(contractId);
        rows.push(...batch.rows);
        cursorByContract.set(contractId, Number(batch.cursorAfter || cursor));
        remaining -= batch.rows.length;
      }

      if (!progressed) break;
    }

    const cursorUpdates = [];
    for (const contractId of contractIds) {
      const existingCursor = Math.max(0, Number(existingCursorMap.get(contractId) || 0));
      const nextCursor = Math.max(0, Number(cursorByContract.get(contractId) || 0));
      const persistedCursor = reconcile ? Math.max(existingCursor, nextCursor) : nextCursor;
      if (!preview && persistedCursor !== existingCursor) {
        cursorUpdates.push({
          contract_id: contractId,
          cursor_log_id: persistedCursor,
        });
      }
      cursorByContract.set(contractId, persistedCursor);
    }

    if (!preview && cursorUpdates.length > 0) {
      this.setPipelineContractCursors(pipeline.id, cursorUpdates);
    }

    let cursorAfter = 0;
    let minContractCursor = Number.MAX_SAFE_INTEGER;
    let pendingContracts = 0;
    let sourceMaxLogId = 0;
    for (const contractId of contractIds) {
      const cursor = Math.max(0, Number(cursorByContract.get(contractId) || 0));
      const sourceMax = Math.max(0, Number(sourceMaxByContract.get(contractId) || 0));
      if (cursor > cursorAfter) cursorAfter = cursor;
      if (cursor < minContractCursor) minContractCursor = cursor;
      if (sourceMax > sourceMaxLogId) sourceMaxLogId = sourceMax;
      if (sourceMax > cursor) pendingContracts += 1;
    }

    if (minContractCursor === Number.MAX_SAFE_INTEGER) {
      minContractCursor = 0;
    }

    return {
      rows,
      rowsRead: rows.length,
      cursorAfter,
      minContractCursor,
      contractCount: contractIds.length,
      touchedContracts: touchedContractIds.size,
      pendingContracts,
      sourceMaxLogId,
    };
  }

  upsertRowsIntoTable(tableName, rows, keyColumns = []) {
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const columns = Object.keys(rows[0]);
    const db = this.database.db;
    const stmt = buildPipelineUpsertStatement(db, tableName, columns, keyColumns);
    let changes = 0;

    const tx = db.transaction((items) => {
      for (const item of items) {
        const values = columns.map((column) => (Object.prototype.hasOwnProperty.call(item, column) ? item[column] : null));
        const result = stmt.run(values);
        changes += Number(result.changes || 0);
      }
    });

    tx.immediate(rows);
    this.database.invalidateMetricsCache();
    this.database.scheduleSave();
    return changes;
  }

  async runBuiltinClmmPoolSnapshots(pipeline, { cursorBefore, limit, preview, reconcile }) {
    const batch = this.queryPipelineContractLogsFair(pipeline, 'clmm_pool_snapshots', {
      limit,
      reconcile,
      reconcileWindowRows: Number(pipeline.spec?.reconcile_window_rows) || 250000,
      eventNames: ['Swap', 'Mint', 'Burn', 'Collect', 'Initialize', 'Flash'],
      preview,
    });

    const bonzoPriceMap = await this.getBonzoPriceMap({ forceRefresh: false });

    const rows = [];
    for (const log of batch.rows) {
      if (!isPoolLike(log)) continue;

      const pair = splitAssetPair(log.asset, log.canonical_name);
      const swap = decodeSwapEvent(log.data);
      const mintBurn = decodeMintBurnEvent(log.data);
      const poolAddress = normalizeAddress(log.evm_address || log.contract_id) || String(log.contract_id || '').toLowerCase();

      const token0Price = pair.token0_symbol ? bonzoPriceMap.bySymbol.get(pair.token0_symbol) ?? null : null;
      const token1Price = pair.token1_symbol ? bonzoPriceMap.bySymbol.get(pair.token1_symbol) ?? null : null;
      const activeLiquidity = swap?.liquidity ?? mintBurn?.liquidity ?? null;

      let tvlUsd = null;
      if (activeLiquidity !== null && token0Price !== null && token1Price !== null) {
        tvlUsd = Math.abs(activeLiquidity) * ((token0Price + token1Price) / 2);
      }

      rows.push({
        snapshot_id: `${log.contract_id}:${log.log_id}`,
        pool_address: poolAddress,
        dex_name: String(log.category || 'unknown').toLowerCase() || 'unknown',
        token0_symbol: pair.token0_symbol,
        token1_symbol: pair.token1_symbol,
        fee_tier_bps: null,
        current_tick: swap?.tick ?? mintBurn?.tick_lower ?? null,
        sqrt_price_x96: swap?.sqrt_price_x96 || null,
        spot_price: swap?.spot_price ?? null,
        active_liquidity: activeLiquidity,
        tvl_usd: tvlUsd,
        block_number: parseNumber(log.block_number, null),
        snapshot_at: toIsoFromConsensusTimestamp(log.timestamp),
        indexed_at: nowIso(),
      });
    }

    const rowsWritten = preview ? 0 : this.upsertRowsIntoTable(pipeline.target_table, rows, ['snapshot_id']);

    return {
      rowsRead: batch.rowsRead,
      rowsWritten,
      cursorAfter: batch.cursorAfter,
      previewRows: rows.slice(0, 25),
      details: {
        preset_key: pipeline.preset_key,
        processed_rows: batch.rowsRead,
        output_rows: rows.length,
        contract_count: batch.contractCount,
        touched_contracts: batch.touchedContracts,
        pending_contracts: batch.pendingContracts,
        source_max_log_id: batch.sourceMaxLogId,
        reconcile,
      },
    };
  }

  async runBuiltinClmmPositions(pipeline, { cursorBefore, limit, preview, reconcile }) {
    const batch = this.queryPipelineContractLogsFair(pipeline, 'clmm_positions', {
      limit,
      reconcile,
      reconcileWindowRows: Number(pipeline.spec?.reconcile_window_rows) || 250000,
      eventNames: ['Mint', 'Burn', 'Collect'],
      preview,
    });

    const rows = [];

    for (const log of batch.rows) {
      if (!isPoolLike(log) && !isVaultLike(log)) continue;

      const eventName = String(log.event_name || '').trim();
      const pair = splitAssetPair(log.asset, log.canonical_name);
      const poolAddress = normalizeAddress(log.evm_address || log.contract_id) || String(log.contract_id || '').toLowerCase();

      const ownerAddress = normalizeTopicAddress(log.topic2) || normalizeTopicAddress(log.topic1) || null;
      const strategyAddress = normalizeTopicAddress(log.topic1) || normalizeTopicAddress(log.topic2) || null;
      const eventTimestamp = toIsoFromConsensusTimestamp(log.timestamp);

      const mintBurn = decodeMintBurnEvent(log.data);
      const collect = decodeCollectEvent(log.data);

      const tickLower = mintBurn?.tick_lower ?? collect?.tick_lower ?? null;
      const tickUpper = mintBurn?.tick_upper ?? collect?.tick_upper ?? null;

      const fallbackPositionId = `${poolAddress}:${ownerAddress || 'unknown'}:${tickLower ?? 'na'}:${tickUpper ?? 'na'}`;
      const positionId = tickLower === null || tickUpper === null ? `${fallbackPositionId}:${log.log_id}` : fallbackPositionId;

      const isMint = eventName === 'Mint';
      const isBurn = eventName === 'Burn';
      const isCollect = eventName === 'Collect';

      rows.push({
        position_id: positionId,
        pool_address: poolAddress,
        vault_address: ownerAddress,
        strategy_address: strategyAddress,
        owner_address: ownerAddress,
        token0_symbol: pair.token0_symbol,
        token1_symbol: pair.token1_symbol,
        tick_lower: tickLower,
        tick_upper: tickUpper,
        liquidity: mintBurn?.liquidity ?? null,
        amount0: mintBurn?.amount0 ?? null,
        amount1: mintBurn?.amount1 ?? null,
        fees_owed0: isCollect ? collect?.amount0 ?? null : null,
        fees_owed1: isCollect ? collect?.amount1 ?? null : null,
        is_active: isMint ? 1 : isBurn ? 0 : null,
        minted_at: isMint ? eventTimestamp : null,
        last_updated_at: eventTimestamp,
        indexed_at: nowIso(),
      });
    }

    const rowsWritten = preview ? 0 : this.upsertRowsIntoTable(pipeline.target_table, rows, ['position_id']);

    return {
      rowsRead: batch.rowsRead,
      rowsWritten,
      cursorAfter: batch.cursorAfter,
      previewRows: rows.slice(0, 25),
      details: {
        preset_key: pipeline.preset_key,
        processed_rows: batch.rowsRead,
        output_rows: rows.length,
        contract_count: batch.contractCount,
        touched_contracts: batch.touchedContracts,
        pending_contracts: batch.pendingContracts,
        source_max_log_id: batch.sourceMaxLogId,
        reconcile,
      },
    };
  }

  buildContractAddressCatalog() {
    const rows = this.database.queryAll(
      `SELECT contract_id, evm_address, category, canonical_name, name
         FROM contracts
        WHERE contract_id IS NOT NULL`
    );

    const byEvmAddress = new Map();
    const byContractId = new Map();
    const vaultIdentityAddresses = new Set();
    const poolAddresses = new Set();
    const strategyCoreAddresses = new Set();
    const vaultNameByAddress = new Map();

    for (const row of rows) {
      const contractId = String(row?.contract_id || '').trim();
      const evmAddress = normalizeAddress(row?.evm_address);
      const category = normalizeCategoryText(row?.category);
      const canonicalName = String(row?.canonical_name || row?.name || '').trim() || null;

      if (contractId) {
        byContractId.set(contractId, {
          contract_id: contractId,
          evm_address: evmAddress,
          category,
          canonical_name: canonicalName,
        });
      }
      if (evmAddress) {
        byEvmAddress.set(evmAddress, {
          contract_id: contractId,
          evm_address: evmAddress,
          category,
          canonical_name: canonicalName,
        });
        if (canonicalName) {
          vaultNameByAddress.set(evmAddress, canonicalName);
        }
      }

      if (evmAddress && VAULT_IDENTITY_CATEGORIES.has(category)) {
        vaultIdentityAddresses.add(evmAddress);
      }
      if (evmAddress && category.includes('pool')) {
        poolAddresses.add(evmAddress);
      }
      if (evmAddress && (category.includes('strategy') || category.includes('core'))) {
        strategyCoreAddresses.add(evmAddress);
      }
    }

    return {
      byEvmAddress,
      byContractId,
      vaultIdentityAddresses,
      poolAddresses,
      strategyCoreAddresses,
      vaultNameByAddress,
    };
  }

  buildAddressToVaultMapFromPositions() {
    const rows = this.database.queryAll(
      `SELECT strategy_address, pool_address, vault_address
         FROM clmm_positions
        WHERE vault_address IS NOT NULL
          AND trim(vault_address) <> ''
        ORDER BY last_updated_at DESC, indexed_at DESC`
    );

    const map = new Map();
    for (const row of rows) {
      const vaultAddress = normalizeAddress(row?.vault_address);
      if (!vaultAddress) continue;

      const strategyAddress = normalizeAddress(row?.strategy_address);
      const poolAddress = normalizeAddress(row?.pool_address);

      if (strategyAddress && !map.has(strategyAddress)) {
        map.set(strategyAddress, vaultAddress);
      }
      if (poolAddress && !map.has(poolAddress)) {
        map.set(poolAddress, vaultAddress);
      }
    }
    return map;
  }

  resolveVaultIdentityForAction({
    emitterAddress,
    emitterCategory,
    topicAddresses = [],
    vaultIdentityAddresses,
    addressToVaultMap,
  }) {
    if (emitterAddress && VAULT_IDENTITY_CATEGORIES.has(normalizeCategoryText(emitterCategory))) {
      return {
        vault_address: emitterAddress,
        resolution: 'emitter_vault_category',
      };
    }

    for (const topicAddress of topicAddresses) {
      if (topicAddress && vaultIdentityAddresses.has(topicAddress)) {
        return {
          vault_address: topicAddress,
          resolution: 'topic_vault_category',
        };
      }
    }

    if (emitterAddress && addressToVaultMap.has(emitterAddress)) {
      return {
        vault_address: addressToVaultMap.get(emitterAddress),
        resolution: 'mapped_strategy_or_core',
      };
    }

    for (const topicAddress of topicAddresses) {
      if (topicAddress && addressToVaultMap.has(topicAddress)) {
        return {
          vault_address: addressToVaultMap.get(topicAddress),
          resolution: 'mapped_strategy_or_core',
        };
      }
    }

    return {
      vault_address: null,
      resolution: 'unresolved',
    };
  }

  resolvePoolAddressForAction({ emitterAddress, emitterCategory, topicAddresses = [], poolAddresses }) {
    if (emitterAddress && normalizeCategoryText(emitterCategory).includes('pool')) {
      return emitterAddress;
    }
    for (const topicAddress of topicAddresses) {
      if (topicAddress && poolAddresses.has(topicAddress)) {
        return topicAddress;
      }
    }
    return null;
  }

  resolveStrategyAddressForAction({ emitterAddress, emitterCategory, topicAddresses = [], strategyCoreAddresses }) {
    const emitterCategoryText = normalizeCategoryText(emitterCategory);
    if (emitterAddress && (emitterCategoryText.includes('strategy') || emitterCategoryText.includes('core'))) {
      return emitterAddress;
    }
    for (const topicAddress of topicAddresses) {
      if (topicAddress && strategyCoreAddresses.has(topicAddress)) {
        return topicAddress;
      }
    }
    return null;
  }

  async runBuiltinVaultActionsDecoded(pipeline, { cursorBefore, limit, preview, reconcile }) {
    const batch = this.queryPipelineContractLogsFair(pipeline, 'vault_actions_decoded', {
      limit,
      reconcile,
      reconcileWindowRows: Number(pipeline.spec?.reconcile_window_rows) || 250000,
      eventNames: null,
      preview,
    });

    const bonzoPriceMap = await this.getBonzoPriceMap({ forceRefresh: false });
    const contractCatalog = this.buildContractAddressCatalog();
    const addressToVaultMap = this.buildAddressToVaultMapFromPositions();
    const rows = [];
    const resolutionCounts = {
      emitter_vault_category: 0,
      topic_vault_category: 0,
      mapped_strategy_or_core: 0,
      unresolved: 0,
    };

    for (const log of batch.rows) {
      const eventName = String(log.event_name || '').trim();
      const pair = splitAssetPair(log.asset, log.canonical_name);
      const actionType = normalizeActionType(eventName, log.topic0);
      const eventTimestamp = toIsoFromConsensusTimestamp(log.timestamp);
      const emitterAddress = normalizeAddress(log.evm_address || log.contract_id);
      const emitterCategory = normalizeCategoryText(log.category);
      const topicAddresses = [log.topic1, log.topic2, log.topic3].map((value) => normalizeTopicAddress(value)).filter(Boolean);

      const resolvedVault = this.resolveVaultIdentityForAction({
        emitterAddress,
        emitterCategory,
        topicAddresses,
        vaultIdentityAddresses: contractCatalog.vaultIdentityAddresses,
        addressToVaultMap,
      });

      resolutionCounts[resolvedVault.resolution] = Number(resolutionCounts[resolvedVault.resolution] || 0) + 1;

      if (!resolvedVault.vault_address) {
        if (!preview) {
          this.database.logIngestError({
            source: 'derived:vault_actions_decoded',
            entityType: 'vault_action_unresolved',
            entityId: `${log.contract_id}:${log.log_id}`,
            reason: 'Unable to resolve vault address from emitter/topic/strategy mapping',
            payload: {
              contract_id: log.contract_id,
              log_id: log.log_id,
              tx_hash: log.tx_hash || null,
              event_name: log.event_name || null,
              topic0: log.topic0 || null,
              topic1: log.topic1 || null,
              topic2: log.topic2 || null,
              topic3: log.topic3 || null,
              emitter_address: emitterAddress,
              emitter_category: emitterCategory,
            },
          });
        }
        continue;
      }

      const swap = decodeSwapEvent(log.data);
      const mintBurn = decodeMintBurnEvent(log.data);
      const collect = decodeCollectEvent(log.data);
      const words = decodeHexWords(log.data);

      let amount0 = null;
      let amount1 = null;
      if (eventName === 'Swap' && swap) {
        amount0 = swap.amount0;
        amount1 = swap.amount1;
      } else if ((eventName === 'Mint' || eventName === 'Burn') && mintBurn) {
        amount0 = mintBurn.amount0;
        amount1 = mintBurn.amount1;
      } else if (eventName === 'Collect' && collect) {
        amount0 = collect.amount0;
        amount1 = collect.amount1;
      } else {
        amount0 = words.length >= 1 ? bigIntToNumber(wordToBigInt(words[0])) : null;
        amount1 = words.length >= 2 ? bigIntToNumber(wordToBigInt(words[1])) : null;
      }

      const shares = words.length >= 3 ? bigIntToNumber(wordToBigInt(words[2])) : null;
      const tickLower = mintBurn?.tick_lower ?? collect?.tick_lower ?? null;
      const tickUpper = mintBurn?.tick_upper ?? collect?.tick_upper ?? null;
      const positionId = words.length > 0 ? `0x${words[0]}` : null;

      const valueUsd = inferValueUsd(amount0, amount1, pair.token0_symbol, pair.token1_symbol, {
        bySymbol: bonzoPriceMap.bySymbol,
      });

      rows.push({
        action_id: `${log.contract_id}:${log.log_id}`,
        vault_address: resolvedVault.vault_address,
        strategy_address: this.resolveStrategyAddressForAction({
          emitterAddress,
          emitterCategory,
          topicAddresses,
          strategyCoreAddresses: contractCatalog.strategyCoreAddresses,
        }),
        pool_address: this.resolvePoolAddressForAction({
          emitterAddress,
          emitterCategory,
          topicAddresses,
          poolAddresses: contractCatalog.poolAddresses,
        }),
        tx_hash: log.tx_hash || null,
        actor_address: normalizeTopicAddress(log.topic1),
        action_type: actionType,
        position_id: positionId,
        tick_lower: tickLower,
        tick_upper: tickUpper,
        amount0,
        amount1,
        shares,
        value_usd: valueUsd,
        block_number: parseNumber(log.block_number, null),
        action_at: eventTimestamp,
        indexed_at: nowIso(),
      });
    }

    const rowsWritten = preview ? 0 : this.upsertRowsIntoTable(pipeline.target_table, rows, ['action_id']);

    return {
      rowsRead: batch.rowsRead,
      rowsWritten,
      cursorAfter: batch.cursorAfter,
      previewRows: rows.slice(0, 25),
      details: {
        preset_key: pipeline.preset_key,
        processed_rows: batch.rowsRead,
        output_rows: rows.length,
        unresolved_count: Number(resolutionCounts.unresolved || 0),
        resolution_counts: resolutionCounts,
        contract_count: batch.contractCount,
        touched_contracts: batch.touchedContracts,
        pending_contracts: batch.pendingContracts,
        source_max_log_id: batch.sourceMaxLogId,
        reconcile,
      },
    };
  }

  resolveVaultName(vaultAddress) {
    const normalizedAddress = normalizeAddress(vaultAddress);
    if (!normalizedAddress) return String(vaultAddress || '').trim() || null;

    const byEvm = this.database.queryOne(
      `SELECT canonical_name, name
         FROM contracts
        WHERE lower(evm_address) = ?
        LIMIT 1`,
      [normalizedAddress]
    );
    if (byEvm?.canonical_name || byEvm?.name) {
      return String(byEvm.canonical_name || byEvm.name).trim();
    }

    const byContractId = this.database.queryOne(
      `SELECT canonical_name, name
         FROM contracts
        WHERE lower(contract_id) = ?
        LIMIT 1`,
      [normalizedAddress]
    );
    if (byContractId?.canonical_name || byContractId?.name) {
      return String(byContractId.canonical_name || byContractId.name).trim();
    }

    return normalizedAddress;
  }

  recomputeVaultState(vaultAddress, bonzoPriceMap) {
    const latestPosition = this.database.queryOne(
      `SELECT * FROM clmm_positions WHERE vault_address = ? ORDER BY last_updated_at DESC, indexed_at DESC LIMIT 1`,
      [vaultAddress]
    );
    if (!latestPosition) {
      return null;
    }

    const latestSnapshot = latestPosition.pool_address
      ? this.database.queryOne(
          `SELECT * FROM clmm_pool_snapshots WHERE pool_address = ? ORDER BY snapshot_at DESC, indexed_at DESC LIMIT 1`,
          [latestPosition.pool_address]
        )
      : null;

    const rebalanceRow = this.database.queryOne(
      `SELECT MAX(action_at) AS last_rebalance_at,
              SUM(CASE WHEN action_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS rebalance_count_24h
         FROM vault_actions_decoded
        WHERE vault_address = ?
          AND lower(action_type) LIKE '%rebalance%'`,
      [vaultAddress]
    );

    const token0 = String(latestPosition.token0_symbol || '').toUpperCase() || null;
    const token1 = String(latestPosition.token1_symbol || '').toUpperCase() || null;
    const token0Price = token0 ? bonzoPriceMap.bySymbol.get(token0) ?? null : null;
    const token1Price = token1 ? bonzoPriceMap.bySymbol.get(token1) ?? null : null;

    const positionAmount0 = parseNumber(latestPosition.amount0, null);
    const positionAmount1 = parseNumber(latestPosition.amount1, null);

    const derivedValueUsd =
      token0Price !== null || token1Price !== null
        ? (token0Price !== null && positionAmount0 !== null ? Math.abs(positionAmount0) * token0Price : 0) +
          (token1Price !== null && positionAmount1 !== null ? Math.abs(positionAmount1) * token1Price : 0)
        : null;

    const snapshotTvlUsd = parseNumber(latestSnapshot?.tvl_usd, null);
    const tvlUsd = snapshotTvlUsd ?? derivedValueUsd;

    const currentTick = parseNumber(latestSnapshot?.current_tick, null);
    const lowerTick = parseNumber(latestPosition.tick_lower, null);
    const upperTick = parseNumber(latestPosition.tick_upper, null);

    const inRange =
      currentTick !== null &&
      lowerTick !== null &&
      upperTick !== null &&
      currentTick >= lowerTick &&
      currentTick <= upperTick
        ? 1
        : 0;

    const deployedRatio = Number(latestPosition.is_active) === 1 ? 1 : 0;
    const idleRatio = 1 - deployedRatio;

    const sharePrice =
      tvlUsd !== null && parseNumber(latestPosition.liquidity, null) !== null && Math.abs(Number(latestPosition.liquidity)) > 0
        ? tvlUsd / Math.abs(Number(latestPosition.liquidity))
        : null;

    return {
      vault_address: vaultAddress,
      vault_name: this.resolveVaultName(vaultAddress),
      strategy_address: latestPosition.strategy_address,
      pool_address: latestPosition.pool_address,
      asset_pair: `${token0 || 'TOKEN0'}/${token1 || 'TOKEN1'}`,
      current_position_id: latestPosition.position_id,
      token0_symbol: token0,
      token1_symbol: token1,
      current_tick: currentTick,
      active_lower_tick: lowerTick,
      active_upper_tick: upperTick,
      in_range: inRange,
      distance_to_lower:
        currentTick !== null && lowerTick !== null ? Math.abs(currentTick - lowerTick) : null,
      distance_to_upper:
        currentTick !== null && upperTick !== null ? Math.abs(upperTick - currentTick) : null,
      idle_ratio: idleRatio,
      deployed_ratio: deployedRatio,
      idle_usd: tvlUsd !== null ? tvlUsd * idleRatio : null,
      deployed_usd: tvlUsd !== null ? tvlUsd * deployedRatio : null,
      tvl_usd: tvlUsd,
      share_price: sharePrice,
      rebalance_count_24h: Number(rebalanceRow?.rebalance_count_24h || 0),
      last_rebalance_at: rebalanceRow?.last_rebalance_at || null,
      state_at: pickLatestIso(latestSnapshot?.snapshot_at, latestPosition.last_updated_at, latestPosition.minted_at),
      indexed_at: nowIso(),
    };
  }

  async runBuiltinVaultStrategyState(pipeline, { cursorBefore, limit, preview, reconcile }) {
    const batch = this.queryPipelineContractLogsFair(pipeline, 'vault_strategy_state', {
      limit,
      reconcile,
      reconcileWindowRows: Number(pipeline.spec?.reconcile_window_rows) || 250000,
      eventNames: ['Mint', 'Burn', 'Collect', 'Swap'],
      preview,
    });

    const affectedVaults = new Set();
    const contractCatalog = this.buildContractAddressCatalog();
    const addressToVaultMap = this.buildAddressToVaultMapFromPositions();
    let earliestBatchEventIso = null;

    for (const log of batch.rows) {
      const eventIso = toIsoFromConsensusTimestamp(log.timestamp);
      if (eventIso && (!earliestBatchEventIso || Date.parse(eventIso) < Date.parse(earliestBatchEventIso))) {
        earliestBatchEventIso = eventIso;
      }

      const candidateAddresses = [
        normalizeAddress(log.evm_address || log.contract_id),
        normalizeTopicAddress(log.topic1),
        normalizeTopicAddress(log.topic2),
        normalizeTopicAddress(log.topic3),
      ].filter(Boolean);

      for (const candidate of candidateAddresses) {
        if (contractCatalog.vaultIdentityAddresses.has(candidate)) {
          affectedVaults.add(candidate);
        }
        const mappedVault = addressToVaultMap.get(candidate);
        if (mappedVault) {
          affectedVaults.add(mappedVault);
        }
      }
    }

    if (earliestBatchEventIso) {
      const actionVaultRows = this.database.queryAll(
        `SELECT DISTINCT vault_address
           FROM vault_actions_decoded
          WHERE vault_address IS NOT NULL
            AND trim(vault_address) <> ''
            AND action_at >= ?
          LIMIT 5000`,
        [earliestBatchEventIso]
      );
      for (const row of actionVaultRows) {
        const normalized = normalizeAddress(row?.vault_address);
        if (normalized) affectedVaults.add(normalized);
      }

      const positionVaultRows = this.database.queryAll(
        `SELECT DISTINCT vault_address
           FROM clmm_positions
          WHERE vault_address IS NOT NULL
            AND trim(vault_address) <> ''
            AND coalesce(last_updated_at, minted_at) >= ?
          LIMIT 5000`,
        [earliestBatchEventIso]
      );
      for (const row of positionVaultRows) {
        const normalized = normalizeAddress(row?.vault_address);
        if (normalized) affectedVaults.add(normalized);
      }
    }

    const bonzoPriceMap = await this.getBonzoPriceMap({ forceRefresh: false });
    const rows = [];

    for (const vaultAddress of affectedVaults) {
      const stateRow = this.recomputeVaultState(vaultAddress, bonzoPriceMap);
      if (stateRow) {
        rows.push(stateRow);
      }
    }

    const rowsWritten = preview ? 0 : this.upsertRowsIntoTable(pipeline.target_table, rows, ['vault_address']);

    return {
      rowsRead: batch.rowsRead,
      rowsWritten,
      cursorAfter: batch.cursorAfter,
      previewRows: rows.slice(0, 25),
      details: {
        preset_key: pipeline.preset_key,
        processed_rows: batch.rowsRead,
        affected_vaults: affectedVaults.size,
        output_rows: rows.length,
        contract_count: batch.contractCount,
        touched_contracts: batch.touchedContracts,
        pending_contracts: batch.pendingContracts,
        source_max_log_id: batch.sourceMaxLogId,
        reconcile,
      },
    };
  }

  getPriorSpotPrice(poolAddress, snapshotAtIso, hoursAgo) {
    if (!poolAddress || !snapshotAtIso || !Number.isFinite(Number(hoursAgo))) return null;
    const snapshotTime = Date.parse(String(snapshotAtIso));
    if (!Number.isFinite(snapshotTime)) return null;
    const targetIso = new Date(snapshotTime - Number(hoursAgo) * 60 * 60 * 1000).toISOString();

    const row = this.database.queryOne(
      `SELECT spot_price
       FROM clmm_pool_snapshots
       WHERE pool_address = ?
         AND snapshot_at <= ?
         AND spot_price IS NOT NULL
       ORDER BY snapshot_at DESC, indexed_at DESC
       LIMIT 1`,
      [poolAddress, targetIso]
    );

    return parseNumber(row?.spot_price, null);
  }

  computeReturn(currentPrice, priorPrice) {
    if (currentPrice === null || priorPrice === null || priorPrice === 0) return null;
    const result = (currentPrice - priorPrice) / priorPrice;
    return Number.isFinite(result) ? result : null;
  }

  computeRealizedVol(returnValue, hoursWindow) {
    if (returnValue === null) return null;
    const scale = Math.sqrt(24 / Math.max(1, Number(hoursWindow) || 1));
    const value = Math.abs(returnValue) * scale;
    return Number.isFinite(value) ? value : null;
  }

  async runBuiltinPriceVolatilitySnapshots(pipeline, { cursorBefore, limit, preview, reconcile }) {
    const startCursor = reconcile
      ? Math.max(0, (Number(this.database.queryOne(`SELECT MAX(rowid) AS max_rowid FROM clmm_pool_snapshots`)?.max_rowid || 0) || 0) - 500000)
      : Math.max(0, Number(cursorBefore || 0));

    const safeLimit = Math.max(1, Math.min(Number(limit) || this.config.derivedBatchSize || 2000, 20000));

    const sourceRows = this.database.queryAll(
      `SELECT rowid AS source_rowid, *
       FROM clmm_pool_snapshots
       WHERE rowid > ?
       ORDER BY rowid ASC
       LIMIT ?`,
      [startCursor, safeLimit]
    );

    const rows = [];
    for (const source of sourceRows) {
      const poolAddress = normalizeAddress(source.pool_address);
      if (!poolAddress) continue;

      const currentPrice = parseNumber(source.spot_price, null);
      if (currentPrice === null) continue;

      const prior1h = this.getPriorSpotPrice(poolAddress, source.snapshot_at, 1);
      const prior6h = this.getPriorSpotPrice(poolAddress, source.snapshot_at, 6);
      const prior24h = this.getPriorSpotPrice(poolAddress, source.snapshot_at, 24);

      const return1h = this.computeReturn(currentPrice, prior1h);
      const return6h = this.computeReturn(currentPrice, prior6h);
      const return24h = this.computeReturn(currentPrice, prior24h);

      const baseSymbol = String(source.token0_symbol || '').trim().toUpperCase() || null;
      const quoteSymbol = String(source.token1_symbol || '').trim().toUpperCase() || null;

      rows.push({
        snapshot_id: `${source.snapshot_id}:vol`,
        market_key: `${poolAddress}:${baseSymbol || 'BASE'}/${quoteSymbol || 'QUOTE'}`,
        base_symbol: baseSymbol,
        quote_symbol: quoteSymbol,
        source: 'derived_indexer',
        interval_label: 'spot',
        price: currentPrice,
        return_1h: return1h,
        return_6h: return6h,
        return_24h: return24h,
        realized_vol_1h: this.computeRealizedVol(return1h, 1),
        realized_vol_6h: this.computeRealizedVol(return6h, 6),
        realized_vol_24h: this.computeRealizedVol(return24h, 24),
        snapshot_at: source.snapshot_at,
        indexed_at: nowIso(),
      });
    }

    const cursorAfter = sourceRows.length > 0 ? Number(sourceRows[sourceRows.length - 1].source_rowid) : startCursor;
    const rowsWritten = preview ? 0 : this.upsertRowsIntoTable(pipeline.target_table, rows, ['snapshot_id']);

    return {
      rowsRead: sourceRows.length,
      rowsWritten,
      cursorAfter,
      previewRows: rows.slice(0, 25),
      details: {
        preset_key: pipeline.preset_key,
        processed_rows: sourceRows.length,
        output_rows: rows.length,
        reconcile,
      },
    };
  }

  async executeSqlTransformPipeline(pipeline, { cursorBefore, limit, preview }) {
    const spec = normalizeSqlPipelineSpec(pipeline.spec || {});
    if (!spec.source_sql) {
      throw new Error('spec.source_sql is required for sql_transform pipeline');
    }

    const cursorValue = cursorBefore ?? 0;
    const renderedSql = spec.source_sql
      .replaceAll('{{cursor}}', escapeSqlLiteral(cursorValue))
      .replaceAll('{{limit}}', String(limit));

    const sourceRows = this.database.queryAll(renderedSql);

    if (preview) {
      return {
        rowsRead: sourceRows.length,
        rowsWritten: 0,
        cursorAfter: cursorBefore,
        previewRows: sourceRows.slice(0, 50),
        details: {
          query_sql: renderedSql,
          source_rows: sourceRows.length,
        },
      };
    }

    await this.ensureTableShape(pipeline.target_table, spec.target_columns, spec.key_columns);

    const transformedRows = [];
    const hasMappings = ensurePlainObject(spec.column_mappings) && Object.keys(spec.column_mappings).length > 0;

    for (const row of sourceRows) {
      const out = {};
      if (hasMappings) {
        for (const [targetField, mapping] of Object.entries(spec.column_mappings)) {
          out[targetField] = resolveMappedValue(mapping, row, spec.defaults || {});
        }
      } else {
        for (const [key, value] of Object.entries(row)) {
          out[key] = value;
        }
      }

      for (const [key, value] of Object.entries(spec.defaults || {})) {
        if (!Object.prototype.hasOwnProperty.call(out, key) || out[key] === undefined) {
          out[key] = value;
        }
      }

      transformedRows.push(out);
    }

    for (const enrichment of spec.enrichment || []) {
      const sourceSlug = String(enrichment.source_slug || '').trim();
      const localField = String(enrichment.local_field || '').trim();
      const remoteField = String(enrichment.remote_field || '').trim();
      const assignments = ensurePlainObject(enrichment.assignments) ? enrichment.assignments : {};
      if (!sourceSlug || !localField || !remoteField || Object.keys(assignments).length === 0) continue;

      const source = this.getSourceBySlug(sourceSlug);
      if (!source) continue;

      const records = this.database.queryAll(
        `SELECT normalized_json FROM external_source_records WHERE source_id = ? ORDER BY observed_at DESC, id DESC LIMIT 10000`,
        [source.id]
      );

      const lookup = new Map();
      for (const record of records) {
        const normalized = parseJsonText(record.normalized_json, {});
        const keyValue = normalized?.[remoteField];
        if (keyValue === undefined || keyValue === null || keyValue === '') continue;
        const key = String(keyValue).toLowerCase();
        if (!lookup.has(key)) {
          lookup.set(key, normalized);
        }
      }

      for (const row of transformedRows) {
        const localValue = row[localField];
        if (localValue === undefined || localValue === null || localValue === '') continue;
        const match = lookup.get(String(localValue).toLowerCase());
        if (!match) continue;
        for (const [targetField, sourceField] of Object.entries(assignments)) {
          row[targetField] = match[sourceField];
        }
      }
    }

    const rowsWritten = this.upsertRowsIntoTable(pipeline.target_table, transformedRows, spec.key_columns || []);

    let cursorAfter = cursorBefore;
    if (spec.cursor_column && sourceRows.length > 0) {
      let maxCursor = parseNumber(cursorBefore, null);
      for (const row of sourceRows) {
        if (!Object.prototype.hasOwnProperty.call(row, spec.cursor_column)) continue;
        const candidate = parseNumber(row[spec.cursor_column], null);
        if (candidate === null) continue;
        if (maxCursor === null || candidate > maxCursor) {
          maxCursor = candidate;
        }
      }
      if (maxCursor !== null) {
        cursorAfter = String(maxCursor);
      }
    }

    return {
      rowsRead: sourceRows.length,
      rowsWritten,
      cursorAfter,
      previewRows: transformedRows.slice(0, 25),
      details: {
        query_sql: renderedSql,
        source_rows: sourceRows.length,
        transformed_rows: transformedRows.length,
      },
    };
  }

  getPipelineBacklogEntry(pipeline) {
    const builtinKey = String(pipeline?.spec?.builtin_key || pipeline?.preset_key || '').trim();
    const base = {
      pipeline_id: pipeline?.id || null,
      pipeline_slug: pipeline?.slug || null,
      preset_key: pipeline?.preset_key || null,
      source_max_log_id: null,
      min_contract_cursor: null,
      pending_contracts: null,
      contract_count: 0,
    };

    if (!builtinKey) {
      return base;
    }

    const filter = this.getBuiltinContractFilterSpec(builtinKey);
    if (filter) {
      const contractIds = this.listSourceContractIdsForBuiltin(pipeline, builtinKey);
      if (contractIds.length === 0) {
        return {
          ...base,
          source_max_log_id: 0,
          min_contract_cursor: 0,
          pending_contracts: 0,
          contract_count: 0,
        };
      }

      const maxByContract = this.queryMaxLogIdByContractIds(contractIds);
      const cursorMap = this.listPipelineContractCursors(pipeline.id, contractIds);

      let sourceMax = 0;
      let minCursor = Number.MAX_SAFE_INTEGER;
      let pending = 0;
      for (const contractId of contractIds) {
        const cursor = Math.max(0, Number(cursorMap.get(contractId) || 0));
        const maxLogId = Math.max(0, Number(maxByContract.get(contractId) || 0));
        if (maxLogId > sourceMax) sourceMax = maxLogId;
        if (cursor < minCursor) minCursor = cursor;
        if (maxLogId > cursor) pending += 1;
      }
      if (minCursor === Number.MAX_SAFE_INTEGER) {
        minCursor = 0;
      }

      return {
        ...base,
        source_max_log_id: sourceMax,
        min_contract_cursor: minCursor,
        pending_contracts: pending,
        contract_count: contractIds.length,
      };
    }

    if (builtinKey === 'price_volatility_snapshots') {
      const sourceMax = Number(this.database.queryOne(`SELECT MAX(rowid) AS max_rowid FROM clmm_pool_snapshots`)?.max_rowid || 0);
      const cursor = Math.max(0, Number(pipeline?.cursor || 0));
      return {
        ...base,
        source_max_log_id: sourceMax,
        min_contract_cursor: cursor,
        pending_contracts: sourceMax > cursor ? 1 : 0,
        contract_count: 1,
      };
    }

    return base;
  }

  resolvePipelinesForRebuild(selection = null) {
    const selectable = this.listPipelines().filter((pipeline) => {
      const builtinKey = String(pipeline?.spec?.builtin_key || pipeline?.preset_key || '').trim();
      return pipeline?.spec?.kind === 'builtin' && Object.prototype.hasOwnProperty.call(DERIVED_REBUILD_TARGET_TABLE_BY_PRESET, builtinKey);
    });

    const selectors = Array.isArray(selection)
      ? selection.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    if (selectors.length === 0) {
      return selectable;
    }

    const selectorSet = new Set(selectors);
    return selectable.filter((pipeline) => {
      const builtinKey = String(pipeline?.spec?.builtin_key || pipeline?.preset_key || '').trim();
      return selectorSet.has(pipeline.id) || selectorSet.has(pipeline.slug) || selectorSet.has(builtinKey);
    });
  }

  resetPipelinesForRebuild(pipelines) {
    const targetTables = Array.from(
      new Set(
        pipelines
          .map((pipeline) => String(pipeline?.target_table || '').trim())
          .filter(Boolean)
      )
    );
    const pipelineIds = pipelines.map((pipeline) => String(pipeline.id));
    const db = this.database.db;

    const tx = db.transaction(() => {
      for (const tableName of targetTables) {
        db.exec(`DELETE FROM ${escapeIdentifier(tableName)}`);
      }

      if (pipelineIds.length > 0) {
        const placeholders = pipelineIds.map(() => '?').join(', ');
        this.database.runStatement(`DELETE FROM derived_pipeline_cursors WHERE pipeline_id IN (${placeholders})`, pipelineIds);
        this.database.runStatement(
          `DELETE FROM derived_pipeline_contract_cursors WHERE pipeline_id IN (${placeholders})`,
          pipelineIds
        );
      }
    });

    tx.immediate();
    this.database.invalidateMetricsCache();
    this.database.scheduleSave();

    return {
      tables_truncated: targetTables,
      pipelines_reset: pipelineIds,
    };
  }

  async rebuildDerivedPipelines(options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || this.config.derivedBatchSize || 2000, 20000));
    const maxPasses = Math.max(1, Math.min(Number(options.max_passes) || 200, 5000));
    const runReconcilePass = parseBoolean(options.reconcile, false);
    const pipelines = this.resolvePipelinesForRebuild(options.pipelines);

    if (pipelines.length === 0) {
      return {
        started_at: nowIso(),
        finished_at: nowIso(),
        limit,
        max_passes: maxPasses,
        pipelines: [],
        reset: {
          tables_truncated: [],
          pipelines_reset: [],
        },
        passes: 0,
        total_runs: 0,
        total_rows_read: 0,
        total_rows_written: 0,
        failed_runs: 0,
        completed: true,
        backlog: [],
      };
    }

    const startedAt = nowIso();
    const reset = this.resetPipelinesForRebuild(pipelines);
    const runResults = [];
    let passes = 0;
    let totalRowsRead = 0;
    let totalRowsWritten = 0;
    let failedRuns = 0;

    for (let pass = 1; pass <= maxPasses; pass += 1) {
      passes = pass;
      let passRowsRead = 0;
      let passRowsWritten = 0;

      for (const pipeline of pipelines) {
        try {
          const execution = await this.runPipelineById(pipeline.id, {
            triggerSource: `rebuild_pass_${pass}`,
            limit,
            preview: false,
            reconcile: false,
          });
          const run = execution.run || {};
          const rowsRead = Number(run.rows_read || 0);
          const rowsWritten = Number(run.rows_written || 0);
          passRowsRead += rowsRead;
          passRowsWritten += rowsWritten;
          totalRowsRead += rowsRead;
          totalRowsWritten += rowsWritten;
          runResults.push({
            pass,
            pipeline_id: pipeline.id,
            pipeline_slug: pipeline.slug,
            run_id: run.id || null,
            status: run.status || 'success',
            rows_read: rowsRead,
            rows_written: rowsWritten,
            error: null,
          });
        } catch (error) {
          failedRuns += 1;
          runResults.push({
            pass,
            pipeline_id: pipeline.id,
            pipeline_slug: pipeline.slug,
            run_id: null,
            status: 'failed',
            rows_read: 0,
            rows_written: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const backlog = pipelines.map((pipeline) => this.getPipelineBacklogEntry(this.getPipelineById(pipeline.id) || pipeline));
      const pendingContracts = backlog.reduce((sum, item) => sum + Number(item.pending_contracts || 0), 0);
      if (passRowsRead === 0 && passRowsWritten === 0 && pendingContracts === 0) {
        break;
      }
    }

    if (runReconcilePass) {
      for (const pipeline of pipelines) {
        try {
          const execution = await this.runPipelineById(pipeline.id, {
            triggerSource: 'rebuild_reconcile',
            limit,
            preview: false,
            reconcile: true,
          });
          const run = execution.run || {};
          runResults.push({
            pass: passes + 1,
            pipeline_id: pipeline.id,
            pipeline_slug: pipeline.slug,
            run_id: run.id || null,
            status: run.status || 'success',
            rows_read: Number(run.rows_read || 0),
            rows_written: Number(run.rows_written || 0),
            error: null,
          });
          totalRowsRead += Number(run.rows_read || 0);
          totalRowsWritten += Number(run.rows_written || 0);
        } catch (error) {
          failedRuns += 1;
          runResults.push({
            pass: passes + 1,
            pipeline_id: pipeline.id,
            pipeline_slug: pipeline.slug,
            run_id: null,
            status: 'failed',
            rows_read: 0,
            rows_written: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const finalPipelines = pipelines.map((pipeline) => this.getPipelineById(pipeline.id) || pipeline);
    const backlog = finalPipelines.map((pipeline) => this.getPipelineBacklogEntry(pipeline));
    const pendingContracts = backlog.reduce((sum, item) => sum + Number(item.pending_contracts || 0), 0);
    const completed = failedRuns === 0 && pendingContracts === 0;

    return {
      started_at: startedAt,
      finished_at: nowIso(),
      limit,
      max_passes: maxPasses,
      pipelines: finalPipelines.map((pipeline) => ({
        id: pipeline.id,
        slug: pipeline.slug,
        preset_key: pipeline.preset_key,
        target_table: pipeline.target_table,
      })),
      reset,
      passes,
      total_runs: runResults.length,
      total_rows_read: totalRowsRead,
      total_rows_written: totalRowsWritten,
      failed_runs: failedRuns,
      completed,
      backlog,
      runs: runResults,
    };
  }

  getStatus() {
    const pipelines = this.listPipelines();
    const runs = this.listPipelineRuns(null, 200);
    const sources = this.listSources();

    const lastPipelineRunAt = runs.length > 0 ? runs[0].started_at : null;
    const failedRuns = runs.filter((run) => run.status === 'failed').length;

    const lag = pipelines
      .map((pipeline) => {
        const ts = Date.parse(String(pipeline.last_run_at || ''));
        if (!Number.isFinite(ts)) return null;
        return Math.max(0, Date.now() - ts);
      })
      .filter((value) => value !== null);

    const maxLagMs = lag.length > 0 ? Math.max(...lag) : null;

    const backlog = pipelines.map((pipeline) => this.getPipelineBacklogEntry(pipeline));

    return {
      enabled: this.config.derivedEnabled,
      initialized_at: this.runtimeStatus.initialized_at,
      last_realtime_run_at: this.runtimeStatus.last_realtime_run_at,
      last_reconcile_at: this.runtimeStatus.last_reconcile_at,
      last_error: this.runtimeStatus.last_error,
      pipelines_total: pipelines.length,
      pipelines_enabled: pipelines.filter((pipeline) => pipeline.enabled).length,
      sources_total: sources.length,
      sources_enabled: sources.filter((source) => source.enabled).length,
      runs_total: runs.length,
      failed_runs: failedRuns,
      last_pipeline_run_at: lastPipelineRunAt,
      max_lag_ms: maxLagMs,
      batch_size: this.config.derivedBatchSize,
      reconcile_cron: this.config.derivedReconcileCron,
      backlog,
    };
  }
}

export { slugify };
