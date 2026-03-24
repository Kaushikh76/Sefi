import crypto from 'crypto';
import { EventEmitter } from 'events';

const FRONTEND_AGENT_ID = 'sefi-frontend-platform-agent';
const PIPELINE_LIFECYCLE_MODES = ['realtime_with_reconcile', 'manual', 'preview', 'run_once', 'rebuild'];
const AGENT_OPERATION_MODES = ['analyze', 'query', 'pipeline_ops', 'source_ops', 'diagnostics', 'clarification'];
const BUILTIN_CUBE_KEYS = new Set([
  'clmm_pool_snapshots',
  'clmm_positions',
  'vault_actions_decoded',
  'vault_strategy_state',
  'price_volatility_snapshots',
  'clmm_agent_state',
]);
const DEFAULT_CONFIRM_TTL_MS = 5 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return text;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizePositiveInt(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;
  if (parsed > max) return fallback;
  return parsed;
}

function normalizeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function asObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}

function sortColumnFromInput(sortBy) {
  const normalized = String(sortBy || 'tvl_usd').trim().toLowerCase();
  if (normalized === 'state_at') return 'state_at';
  if (normalized === 'share_price') return 'share_price';
  if (normalized === 'idle_ratio') return 'idle_ratio';
  if (normalized === 'deployed_ratio') return 'deployed_ratio';
  if (normalized === 'current_tick') return 'current_tick';
  return 'tvl_usd';
}

function inferIntent(question, requestedIntent = null) {
  const explicit = String(requestedIntent || '').trim().toLowerCase();
  if (AGENT_OPERATION_MODES.includes(explicit)) {
    return explicit;
  }

  const text = String(question || '').toLowerCase();
  if (/(\b(rebuild|truncate|reset)\b)/.test(text)) return 'pipeline_ops';
  if (/(\brun all pipelines\b|\brun pipelines\b)/.test(text)) return 'pipeline_ops';
  if (/(\bpreview pipeline\b|\brun pipeline\b|\bpipeline status\b)/.test(text)) return 'pipeline_ops';
  if (/(\bsource test\b|\btest source\b|\blist sources\b)/.test(text)) return 'source_ops';
  if (/(\blag\b|\bbacklog\b|\bfailed runs\b|\bdiagnostic\b)/.test(text)) return 'diagnostics';
  if (/(\banalyze\b|\bexplain\b)/.test(text)) return 'analyze';
  if (/(\bclarify\b|\bunclear\b)/.test(text)) return 'clarification';
  return 'query';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function createChatError(message, code = 'AGENT_CHAT_ERROR', status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function subtractDaysFromIso(anchorIso, days) {
  const date = new Date(anchorIso);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

export class FrontendAgentPlatformService {
  constructor({
    config,
    database,
    derivedService,
    agentService,
    agentOrchestrator,
    fetchCubeMeta,
    onEvent = null,
  } = {}) {
    this.config = config;
    this.database = database;
    this.derivedService = derivedService;
    this.agentService = agentService;
    this.agentOrchestrator = agentOrchestrator;
    this.fetchCubeMeta = fetchCubeMeta;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;

    this.eventBus = new EventEmitter();
    this.confirmChallenges = new Map();
    this.confirmationTtlMs = DEFAULT_CONFIRM_TTL_MS;
  }

  emitSessionEvent(sessionId, eventType, payload = {}, level = 'info') {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return;

    const eventRecord = this.database.createAgentChatEvent({
      session_id: normalizedSessionId,
      message_id: payload?.message_id ? String(payload.message_id) : null,
      event_type: String(eventType || 'event'),
      level: String(level || 'info'),
      payload,
    });

    const streamPayload = {
      session_id: normalizedSessionId,
      event_type: String(eventType || 'event'),
      level: String(level || 'info'),
      payload,
      created_at: eventRecord?.created_at || nowIso(),
      id: eventRecord?.id ?? null,
    };

    this.eventBus.emit('session_event', streamPayload);
    if (this.onEvent) {
      this.onEvent('agent_chat_event', streamPayload);
    }
  }

  subscribeSession(sessionId, listener) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return () => {};
    }

    const handler = (event) => {
      if (String(event?.session_id || '') !== normalizedSessionId) return;
      listener(event);
    };

    this.eventBus.on('session_event', handler);
    return () => {
      this.eventBus.off('session_event', handler);
    };
  }

  cleanupExpiredChallenges() {
    const nowMs = Date.now();
    for (const [token, challenge] of this.confirmChallenges.entries()) {
      if (!challenge || Number(challenge.expires_at_ms || 0) <= nowMs) {
        this.confirmChallenges.delete(token);
      }
    }
  }

  issueConfirmationChallenge({ sessionId, intent, action, toolInput, question }) {
    this.cleanupExpiredChallenges();
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + this.confirmationTtlMs;
    const token = crypto.randomUUID();
    const challenge = {
      token,
      session_id: String(sessionId || ''),
      intent: String(intent || 'pipeline_ops'),
      action: String(action || 'rebuild'),
      question: String(question || ''),
      tool_input: cloneJson(toolInput || {}),
      issued_at: new Date(issuedAtMs).toISOString(),
      expires_at: new Date(expiresAtMs).toISOString(),
      expires_at_ms: expiresAtMs,
      challenge_hash: stableHash({
        session_id: String(sessionId || ''),
        intent: String(intent || 'pipeline_ops'),
        action: String(action || 'rebuild'),
        question: String(question || ''),
        tool_input: cloneJson(toolInput || {}),
      }),
    };
    this.confirmChallenges.set(token, challenge);

    return {
      requires_confirmation: true,
      confirmation: {
        confirmation_token: token,
        action: challenge.action,
        reason: 'destructive_operation',
        issued_at: challenge.issued_at,
        expires_at: challenge.expires_at,
      },
    };
  }

  consumeConfirmation({ token, sessionId, intent, action, toolInput, question }) {
    this.cleanupExpiredChallenges();
    const normalized = String(token || '').trim();
    if (!normalized) {
      throw createChatError('confirm_token is required for destructive actions', 'CONFIRMATION_REQUIRED', 409);
    }

    const challenge = this.confirmChallenges.get(normalized);
    if (!challenge) {
      throw createChatError('confirm_token is invalid or expired', 'CONFIRMATION_INVALID', 409);
    }

    if (challenge.session_id !== String(sessionId || '')) {
      throw createChatError('confirm_token does not match this chat session', 'CONFIRMATION_INVALID', 409);
    }

    if (Number(challenge.expires_at_ms || 0) <= Date.now()) {
      this.confirmChallenges.delete(normalized);
      throw createChatError('confirm_token has expired', 'CONFIRMATION_EXPIRED', 409);
    }

    const currentHash = stableHash({
      session_id: String(sessionId || ''),
      intent: String(intent || 'pipeline_ops'),
      action: String(action || 'rebuild'),
      question: String(question || ''),
      tool_input: cloneJson(toolInput || {}),
    });

    if (currentHash !== challenge.challenge_hash) {
      throw createChatError('confirm_token does not match the requested action', 'CONFIRMATION_INVALID', 409);
    }

    this.confirmChallenges.delete(normalized);
    return true;
  }

  ensureFrontendAgent() {
    let existing = null;
    try {
      existing = this.agentOrchestrator.getAgent(FRONTEND_AGENT_ID);
    } catch {
      existing = null;
    }
    if (existing) {
      return {
        created: false,
        agent: existing,
      };
    }

    const created = this.agentOrchestrator.createAgent({
      id: FRONTEND_AGENT_ID,
      name: 'SeFi Frontend Platform Agent',
      type: 'hedera',
      network: String(this.config?.network || 'testnet'),
      model_provider: 'openai',
      model_name: String(this.config?.openaiModelFast || 'gpt-5-mini'),
      system_prompt: [
        'You are the SeFi frontend platform agent.',
        'Prioritize deterministic tool routing for query, pipeline ops, source ops, and diagnostics.',
        'Use semantic cube queries first and SQL fallback only when explicitly allowed.',
        'For destructive operations, require explicit confirmation token.',
      ].join('\n'),
      topics: ['frontend', 'derived', 'analytics', 'vaults'],
      semantic_scope: {
        allowed_cubes: [],
        allowed_members: [],
        time_window: 'all',
        max_rows: 2000,
      },
      tool_allowlist: [
        'sefi.semantic.context',
        'sefi.semantic.query',
        'sefi.derived.status',
        'sefi.derived.run',
        'sefi.derived.source.test',
        'sefi.diagnostics',
      ],
      publish_targets: {
        hcs: { enabled: false },
        twitter: { enabled: false },
      },
      schedule: {
        enabled: false,
        cadence: 'manual',
        action: 'manual',
      },
    });

    this.database.logActivity('agent_bootstrap', created.id, 'Bootstrapped frontend platform agent');
    return {
      created: true,
      agent: created,
    };
  }

  async getCatalog() {
    let cubeMeta = { cubes: [] };
    let cubeMetaSource = 'cube';
    let cubeMetaError = null;

    try {
      cubeMeta = await this.fetchCubeMeta();
    } catch (error) {
      cubeMetaError = error instanceof Error ? error.message : String(error);
      cubeMetaSource = 'unavailable';
      cubeMeta = {
        cubes: [],
      };
    }

    const cubes = Array.isArray(cubeMeta?.cubes)
      ? cubeMeta.cubes
          .map((cube) => {
            const name = String(cube?.name || '').trim();
            if (!name) return null;
            return {
              name,
              title: cube?.title ? String(cube.title) : null,
              measures: Array.isArray(cube?.measures)
                ? cube.measures.map((measure) => ({
                    name: String(measure?.name || ''),
                    title: measure?.title ? String(measure.title) : null,
                    type: measure?.type ? String(measure.type) : null,
                  }))
                : [],
              dimensions: Array.isArray(cube?.dimensions)
                ? cube.dimensions.map((dimension) => ({
                    name: String(dimension?.name || ''),
                    title: dimension?.title ? String(dimension.title) : null,
                    type: dimension?.type ? String(dimension.type) : null,
                  }))
                : [],
            };
          })
          .filter(Boolean)
      : [];

    const derivedStatus = this.derivedService.getStatus();
    const pipelines = this.derivedService.listPipelines();
    const sources = this.derivedService.listSources();

    const frontendAgent = this.ensureFrontendAgent();

    return {
      generated_at: nowIso(),
      cubes: {
        source: cubeMetaSource,
        error: cubeMetaError,
        count: cubes.length,
        records: cubes,
      },
      derived: {
        status: derivedStatus,
        pipelines: pipelines.map((pipeline) => ({
          id: pipeline.id,
          slug: pipeline.slug,
          name: pipeline.name,
          preset_key: pipeline.preset_key,
          target_table: pipeline.target_table,
          enabled: pipeline.enabled,
          realtime_enabled: pipeline.realtime_enabled,
          is_system: pipeline.is_system,
          last_run_at: pipeline.last_run_at,
          last_run_status: pipeline.last_run_status,
          last_error: pipeline.last_error,
          cursor: pipeline.cursor,
          is_builtin_cube_product: BUILTIN_CUBE_KEYS.has(String(pipeline.preset_key || '').trim()),
        })),
        sources: sources.map((source) => ({
          id: source.id,
          slug: source.slug,
          name: source.name,
          enabled: source.enabled,
          is_system: source.is_system,
          preset_key: source.preset_key,
          base_url: source.base_url,
          auth_mode: source.auth_mode,
          last_success_at: source.last_success_at,
          last_error: source.last_error,
        })),
      },
      modes: {
        pipeline_lifecycle: PIPELINE_LIFECYCLE_MODES,
        agent_operations: AGENT_OPERATION_MODES,
      },
      agent_defaults: {
        frontend_agent_id: FRONTEND_AGENT_ID,
        auto_execute: true,
        allow_sql_fallback: false,
        max_rows: 200,
        created: frontendAgent.created,
      },
    };
  }

  listVaults(options = {}) {
    const limit = normalizePositiveInt(options.limit, 3, 1, 200);
    const sortColumn = sortColumnFromInput(options.sort);

    const rows = this.database.queryAll(
      `SELECT
         vault_address,
         vault_name,
         strategy_address,
         pool_address,
         asset_pair,
         current_tick,
         active_lower_tick,
         active_upper_tick,
         in_range,
         idle_ratio,
         deployed_ratio,
         tvl_usd,
         share_price,
         rebalance_count_24h,
         state_at,
         indexed_at
       FROM vault_strategy_state
       ORDER BY ${sortColumn === 'state_at' ? 'state_at' : `${sortColumn} DESC`}, state_at DESC, vault_address ASC
       LIMIT ?`,
      [limit]
    );

    return {
      count: rows.length,
      records: rows.map((row) => ({
        vault_address: row.vault_address || null,
        vault_name: row.vault_name || null,
        strategy_address: row.strategy_address || null,
        pool_address: row.pool_address || null,
        asset_pair: row.asset_pair || null,
        current_tick: normalizeNumber(row.current_tick, null),
        active_lower_tick: normalizeNumber(row.active_lower_tick, null),
        active_upper_tick: normalizeNumber(row.active_upper_tick, null),
        in_range: Number(row.in_range || 0) === 1,
        idle_ratio: normalizeNumber(row.idle_ratio, null),
        deployed_ratio: normalizeNumber(row.deployed_ratio, null),
        tvl_usd: normalizeNumber(row.tvl_usd, null),
        share_price: normalizeNumber(row.share_price, null),
        rebalance_count_24h: normalizeNumber(row.rebalance_count_24h, null),
        state_at: row.state_at || null,
        indexed_at: row.indexed_at || null,
      })),
      sort: sortColumn,
      limit,
    };
  }

  getVaultOverview(vaultAddress) {
    const normalizedVault = normalizeAddress(vaultAddress);
    if (!normalizedVault) {
      throw createChatError('vaultAddress is required', 'INVALID_VAULT_ADDRESS', 400);
    }

    const state = this.database.queryOne(
      `SELECT * FROM vault_strategy_state WHERE lower(vault_address) = ? LIMIT 1`,
      [normalizedVault]
    );

    if (!state) {
      throw createChatError(`Vault not found: ${vaultAddress}`, 'NOT_FOUND', 404);
    }

    const positionStats = this.database.queryOne(
      `SELECT
         COUNT(*) AS total_positions,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_positions,
         MAX(last_updated_at) AS last_position_update
       FROM clmm_positions
       WHERE lower(vault_address) = ?`,
      [normalizedVault]
    ) || { total_positions: 0, active_positions: 0, last_position_update: null };

    const latestActionAt = this.database.queryOne(
      `SELECT MAX(action_at) AS latest_action_at
       FROM vault_actions_decoded
       WHERE lower(vault_address) = ?`,
      [normalizedVault]
    )?.latest_action_at || null;

    const actionWindowStart = latestActionAt ? subtractDaysFromIso(latestActionAt, 1) : null;
    const action24hCount = actionWindowStart
      ? this.database.queryOne(
          `SELECT COUNT(*) AS count
             FROM vault_actions_decoded
            WHERE lower(vault_address) = ?
              AND action_at >= ?`,
          [normalizedVault, actionWindowStart]
        )?.count || 0
      : 0;

    const latestPoolSnapshot = state.pool_address
      ? this.database.queryOne(
          `SELECT
             pool_address,
             dex_name,
             token0_symbol,
             token1_symbol,
             current_tick,
             spot_price,
             tvl_usd,
             snapshot_at,
             indexed_at
           FROM clmm_pool_snapshots
           WHERE lower(pool_address) = ?
           ORDER BY snapshot_at DESC, indexed_at DESC
           LIMIT 1`,
          [normalizeAddress(state.pool_address)]
        )
      : null;

    return {
      vault: {
        vault_address: state.vault_address || null,
        vault_name: state.vault_name || state.vault_address || null,
        strategy_address: state.strategy_address || null,
        pool_address: state.pool_address || null,
        asset_pair: state.asset_pair || null,
      },
      state: {
        current_tick: normalizeNumber(state.current_tick, null),
        active_lower_tick: normalizeNumber(state.active_lower_tick, null),
        active_upper_tick: normalizeNumber(state.active_upper_tick, null),
        in_range: Number(state.in_range || 0) === 1,
        idle_ratio: normalizeNumber(state.idle_ratio, null),
        deployed_ratio: normalizeNumber(state.deployed_ratio, null),
        tvl_usd: normalizeNumber(state.tvl_usd, null),
        share_price: normalizeNumber(state.share_price, null),
        rebalance_count_24h: normalizeNumber(state.rebalance_count_24h, null),
        last_rebalance_at: state.last_rebalance_at || null,
        state_at: state.state_at || null,
        indexed_at: state.indexed_at || null,
      },
      positions: {
        total_positions: Number(positionStats.total_positions || 0),
        active_positions: Number(positionStats.active_positions || 0),
        last_position_update: positionStats.last_position_update || null,
      },
      actions: {
        latest_action_at: latestActionAt,
        count_last_24h: Number(action24hCount || 0),
      },
      latest_pool_snapshot: latestPoolSnapshot
        ? {
            pool_address: latestPoolSnapshot.pool_address || null,
            dex_name: latestPoolSnapshot.dex_name || null,
            token0_symbol: latestPoolSnapshot.token0_symbol || null,
            token1_symbol: latestPoolSnapshot.token1_symbol || null,
            current_tick: normalizeNumber(latestPoolSnapshot.current_tick, null),
            spot_price: normalizeNumber(latestPoolSnapshot.spot_price, null),
            tvl_usd: normalizeNumber(latestPoolSnapshot.tvl_usd, null),
            snapshot_at: latestPoolSnapshot.snapshot_at || null,
            indexed_at: latestPoolSnapshot.indexed_at || null,
          }
        : null,
    };
  }

  getVaultPositions(vaultAddress, options = {}) {
    const normalizedVault = normalizeAddress(vaultAddress);
    if (!normalizedVault) {
      throw createChatError('vaultAddress is required', 'INVALID_VAULT_ADDRESS', 400);
    }
    const limit = normalizePositiveInt(options.limit, 100, 1, 1000);

    const rows = this.database.queryAll(
      `SELECT
         position_id,
         pool_address,
         vault_address,
         strategy_address,
         owner_address,
         token0_symbol,
         token1_symbol,
         tick_lower,
         tick_upper,
         liquidity,
         amount0,
         amount1,
         fees_owed0,
         fees_owed1,
         is_active,
         minted_at,
         last_updated_at,
         indexed_at
       FROM clmm_positions
       WHERE lower(vault_address) = ?
       ORDER BY last_updated_at DESC, indexed_at DESC
       LIMIT ?`,
      [normalizedVault, limit]
    );

    return {
      vault_address: normalizedVault,
      count: rows.length,
      limit,
      records: rows.map((row) => ({
        position_id: row.position_id || null,
        pool_address: row.pool_address || null,
        vault_address: row.vault_address || null,
        strategy_address: row.strategy_address || null,
        owner_address: row.owner_address || null,
        token0_symbol: row.token0_symbol || null,
        token1_symbol: row.token1_symbol || null,
        tick_lower: normalizeNumber(row.tick_lower, null),
        tick_upper: normalizeNumber(row.tick_upper, null),
        range_width:
          normalizeNumber(row.tick_upper, null) !== null && normalizeNumber(row.tick_lower, null) !== null
            ? Number(row.tick_upper) - Number(row.tick_lower)
            : null,
        liquidity: normalizeNumber(row.liquidity, null),
        amount0: normalizeNumber(row.amount0, null),
        amount1: normalizeNumber(row.amount1, null),
        fees_owed0: normalizeNumber(row.fees_owed0, null),
        fees_owed1: normalizeNumber(row.fees_owed1, null),
        is_active: Number(row.is_active || 0) === 1,
        minted_at: row.minted_at || null,
        last_updated_at: row.last_updated_at || null,
        indexed_at: row.indexed_at || null,
      })),
    };
  }

  resolveActionAnchor(days) {
    const latest = this.database.queryOne(`SELECT MAX(action_at) AS max_action_at FROM vault_actions_decoded`)?.max_action_at;
    if (!latest) return null;
    return subtractDaysFromIso(latest, days);
  }

  getVaultActions(vaultAddress, options = {}) {
    const normalizedVault = normalizeAddress(vaultAddress);
    if (!normalizedVault) {
      throw createChatError('vaultAddress is required', 'INVALID_VAULT_ADDRESS', 400);
    }

    const days = normalizePositiveInt(options.days, 7, 1, 365);
    const limit = normalizePositiveInt(options.limit, 200, 1, 1000);
    const anchorStart = this.resolveActionAnchor(days);

    const rows = anchorStart
      ? this.database.queryAll(
          `SELECT
             action_id,
             vault_address,
             strategy_address,
             pool_address,
             tx_hash,
             actor_address,
             action_type,
             position_id,
             tick_lower,
             tick_upper,
             amount0,
             amount1,
             shares,
             value_usd,
             block_number,
             action_at,
             indexed_at
           FROM vault_actions_decoded
           WHERE lower(vault_address) = ?
             AND action_at >= ?
           ORDER BY action_at DESC, indexed_at DESC
           LIMIT ?`,
          [normalizedVault, anchorStart, limit]
        )
      : this.database.queryAll(
          `SELECT
             action_id,
             vault_address,
             strategy_address,
             pool_address,
             tx_hash,
             actor_address,
             action_type,
             position_id,
             tick_lower,
             tick_upper,
             amount0,
             amount1,
             shares,
             value_usd,
             block_number,
             action_at,
             indexed_at
           FROM vault_actions_decoded
           WHERE lower(vault_address) = ?
           ORDER BY action_at DESC, indexed_at DESC
           LIMIT ?`,
          [normalizedVault, limit]
        );

    return {
      vault_address: normalizedVault,
      count: rows.length,
      limit,
      days,
      anchored_window_start: anchorStart,
      records: rows.map((row) => ({
        action_id: row.action_id || null,
        vault_address: row.vault_address || null,
        strategy_address: row.strategy_address || null,
        pool_address: row.pool_address || null,
        tx_hash: row.tx_hash || null,
        actor_address: row.actor_address || null,
        action_type: row.action_type || null,
        position_id: row.position_id || null,
        tick_lower: normalizeNumber(row.tick_lower, null),
        tick_upper: normalizeNumber(row.tick_upper, null),
        amount0: normalizeNumber(row.amount0, null),
        amount1: normalizeNumber(row.amount1, null),
        shares: normalizeNumber(row.shares, null),
        value_usd: normalizeNumber(row.value_usd, null),
        block_number: normalizeNumber(row.block_number, null),
        action_at: row.action_at || null,
        indexed_at: row.indexed_at || null,
      })),
    };
  }

  getVaultRisk(vaultAddress) {
    const normalizedVault = normalizeAddress(vaultAddress);
    if (!normalizedVault) {
      throw createChatError('vaultAddress is required', 'INVALID_VAULT_ADDRESS', 400);
    }

    const state = this.database.queryOne(
      `SELECT * FROM vault_strategy_state WHERE lower(vault_address) = ? LIMIT 1`,
      [normalizedVault]
    );

    if (!state) {
      throw createChatError(`Vault not found: ${vaultAddress}`, 'NOT_FOUND', 404);
    }

    const token0 = String(state.token0_symbol || '').toUpperCase();
    const token1 = String(state.token1_symbol || '').toUpperCase();

    const latestVol = token0 && token1
      ? this.database.queryOne(
          `SELECT
             market_key,
             base_symbol,
             quote_symbol,
             realized_vol_1h,
             realized_vol_6h,
             realized_vol_24h,
             snapshot_at
           FROM price_volatility_snapshots
           WHERE (
             upper(base_symbol) = ? AND upper(quote_symbol) = ?
           ) OR (
             upper(base_symbol) = ? AND upper(quote_symbol) = ?
           )
           ORDER BY snapshot_at DESC, indexed_at DESC
           LIMIT 1`,
          [token0, token1, token1, token0]
        )
      : null;

    const distanceLower = normalizeNumber(state.distance_to_lower, null);
    const distanceUpper = normalizeNumber(state.distance_to_upper, null);
    const nearestBoundaryDistance =
      distanceLower !== null && distanceUpper !== null
        ? Math.min(distanceLower, distanceUpper)
        : distanceLower ?? distanceUpper ?? null;

    return {
      vault_address: state.vault_address || null,
      vault_name: state.vault_name || state.vault_address || null,
      asset_pair: state.asset_pair || null,
      in_range: Number(state.in_range || 0) === 1,
      nearest_boundary_distance: nearestBoundaryDistance,
      realized_vol_1h: normalizeNumber(latestVol?.realized_vol_1h, normalizeNumber(state.realized_vol_1h, null)),
      realized_vol_6h: normalizeNumber(latestVol?.realized_vol_6h, normalizeNumber(state.realized_vol_6h, null)),
      realized_vol_24h: normalizeNumber(latestVol?.realized_vol_24h, normalizeNumber(state.realized_vol_24h, null)),
      tvl_usd: normalizeNumber(state.tvl_usd, null),
      idle_ratio: normalizeNumber(state.idle_ratio, null),
      deployed_ratio: normalizeNumber(state.deployed_ratio, null),
      latest_volatility_snapshot_at: latestVol?.snapshot_at || null,
      state_at: state.state_at || null,
      indexed_at: state.indexed_at || null,
    };
  }

  createChatSession(input = {}) {
    const ensured = this.ensureFrontendAgent();
    const payload = {
      id: crypto.randomUUID(),
      agent_id: String(input.agent_id || ensured.agent.id || FRONTEND_AGENT_ID),
      title: String(input.title || 'Frontend Agent Session').trim().slice(0, 200),
      mode: 'stateful',
      metadata: asObject(input.metadata, {}),
      auto_execute: normalizeBoolean(input.auto_execute, true),
    };

    return this.database.createAgentChatSession(payload);
  }

  getChatSession(sessionId) {
    const session = this.database.getAgentChatSessionById(String(sessionId || ''));
    if (!session) {
      throw createChatError(`Chat session not found: ${sessionId}`, 'NOT_FOUND', 404);
    }
    return session;
  }

  listChatMessages(sessionId, limit = 100) {
    this.getChatSession(sessionId);
    return this.database.listAgentChatMessages(String(sessionId || ''), limit);
  }

  listChatEvents(sessionId, limit = 200) {
    this.getChatSession(sessionId);
    return this.database.listAgentChatEvents(String(sessionId || ''), limit);
  }

  normalizeChatOptions(options = {}, defaultAutoExecute = true) {
    const base = asObject(options, {});
    return {
      auto_execute: normalizeBoolean(base.auto_execute, defaultAutoExecute),
      strong_model: normalizeBoolean(base.strong_model, false),
      allow_sql_fallback: normalizeBoolean(base.allow_sql_fallback, false),
      max_rows: normalizePositiveInt(base.max_rows, 200, 1, 2000),
    };
  }

  findPipelineBySelector(selector) {
    const text = String(selector || '').trim();
    if (!text) return null;
    return this.derivedService.getPipelineById(text) || this.derivedService.getPipelineBySlug(text) || null;
  }

  findSourceBySelector(selector) {
    const text = String(selector || '').trim();
    if (!text) return null;
    return this.derivedService.getSourceById(text) || this.derivedService.getSourceBySlug(text) || null;
  }

  inferPipelineAction(question, toolInput = {}) {
    const explicit = String(toolInput.action || '').trim().toLowerCase();
    if (['run', 'run_all', 'preview', 'status', 'rebuild'].includes(explicit)) {
      return explicit;
    }

    const text = String(question || '').toLowerCase();
    if (/(\brebuild\b|\btruncate\b|\breset\b)/.test(text)) return 'rebuild';
    if (/(\brun all\b)/.test(text)) return 'run_all';
    if (/(\bpreview\b)/.test(text)) return 'preview';
    if (/(\bstatus\b|\blag\b|\bbacklog\b)/.test(text)) return 'status';
    return 'run';
  }

  inferSourceAction(question, toolInput = {}) {
    const explicit = String(toolInput.action || '').trim().toLowerCase();
    if (['list', 'test'].includes(explicit)) return explicit;
    const text = String(question || '').toLowerCase();
    if (/(\btest\b)/.test(text)) return 'test';
    return 'list';
  }

  async executeIntent({ sessionId = null, question, intent, toolInput = {}, options = {}, confirmToken = '' }) {
    const normalizedIntent = inferIntent(question, intent);
    const input = asObject(toolInput, {});

    if (normalizedIntent === 'diagnostics') {
      const status = this.derivedService.getStatus();
      const runs = this.derivedService.listPipelineRuns(null, normalizePositiveInt(input.limit, 20, 1, 200));
      return {
        mode: 'diagnostics',
        tool_call: {
          tool: 'derived.status',
        },
        result: {
          status,
          recent_runs: runs,
        },
      };
    }

    if (normalizedIntent === 'pipeline_ops') {
      const action = this.inferPipelineAction(question, input);
      if (action === 'status') {
        return {
          mode: 'pipeline_ops',
          tool_call: {
            tool: 'derived.status',
            action,
          },
          result: this.derivedService.getStatus(),
        };
      }

      if (action === 'run_all') {
        const execution = await this.derivedService.runAllPipelines({
          triggerSource: 'agent_chat',
          reconcile: normalizeBoolean(input.reconcile, false),
          includeDisabled: normalizeBoolean(input.include_disabled, false),
          limit: normalizePositiveInt(input.limit, this.config.derivedBatchSize || 2000, 1, 20000),
        });
        return {
          mode: 'pipeline_ops',
          tool_call: {
            tool: 'derived.pipelines.run_all',
            action,
          },
          result: execution,
        };
      }

      if (action === 'preview') {
        const pipeline = this.findPipelineBySelector(input.pipeline || input.pipeline_id || input.pipeline_slug);
        if (!pipeline) {
          throw createChatError('pipeline is required for preview action', 'INVALID_PIPELINE_SELECTOR', 400);
        }

        const execution = await this.derivedService.runPipelinePreview(pipeline.id, {
          limit: normalizePositiveInt(input.limit, 25, 1, 500),
        });
        return {
          mode: 'pipeline_ops',
          tool_call: {
            tool: 'derived.pipelines.preview',
            action,
            pipeline_id: pipeline.id,
            pipeline_slug: pipeline.slug,
          },
          result: execution,
        };
      }

      if (action === 'rebuild') {
        const rebuildInput = {
          pipelines: Array.isArray(input.pipelines)
            ? input.pipelines.map((value) => String(value || '').trim()).filter(Boolean)
            : [],
          limit: normalizePositiveInt(input.limit, this.config.derivedBatchSize || 2000, 1, 20000),
          max_passes: normalizePositiveInt(input.max_passes, 200, 1, 5000),
          reconcile: normalizeBoolean(input.reconcile, false),
        };

        if (!confirmToken) {
          return {
            mode: 'pipeline_ops',
            tool_call: {
              tool: 'derived.pipelines.rebuild',
              action,
            },
            result: this.issueConfirmationChallenge({
              sessionId,
              intent: normalizedIntent,
              action,
              toolInput: rebuildInput,
              question,
            }),
          };
        }

        this.consumeConfirmation({
          token: confirmToken,
          sessionId,
          intent: normalizedIntent,
          action,
          toolInput: rebuildInput,
          question,
        });

        const execution = await this.derivedService.rebuildDerivedPipelines(rebuildInput);
        return {
          mode: 'pipeline_ops',
          tool_call: {
            tool: 'derived.pipelines.rebuild',
            action,
          },
          result: execution,
        };
      }

      const pipeline = this.findPipelineBySelector(input.pipeline || input.pipeline_id || input.pipeline_slug);
      if (!pipeline) {
        throw createChatError('pipeline is required for run action', 'INVALID_PIPELINE_SELECTOR', 400);
      }

      const execution = await this.derivedService.runPipelineById(pipeline.id, {
        triggerSource: 'agent_chat',
        reconcile: normalizeBoolean(input.reconcile, false),
        limit: normalizePositiveInt(input.limit, this.config.derivedBatchSize || 2000, 1, 20000),
      });

      return {
        mode: 'pipeline_ops',
        tool_call: {
          tool: 'derived.pipelines.run',
          action: 'run',
          pipeline_id: pipeline.id,
          pipeline_slug: pipeline.slug,
        },
        result: execution,
      };
    }

    if (normalizedIntent === 'source_ops') {
      const action = this.inferSourceAction(question, input);
      if (action === 'list') {
        return {
          mode: 'source_ops',
          tool_call: {
            tool: 'derived.sources.list',
            action,
          },
          result: {
            count: this.derivedService.listSources().length,
            records: this.derivedService.listSources(),
          },
        };
      }

      const source = this.findSourceBySelector(input.source || input.source_id || input.source_slug);
      if (!source) {
        throw createChatError('source is required for source test action', 'INVALID_SOURCE_SELECTOR', 400);
      }

      const execution = await this.derivedService.runSource(source.id, {
        triggerSource: 'agent_chat',
        persist: normalizeBoolean(input.persist, true),
        maxRecords: normalizePositiveInt(input.max_records, 500, 1, 10000),
      });

      return {
        mode: 'source_ops',
        tool_call: {
          tool: 'derived.sources.test',
          action,
          source_id: source.id,
          source_slug: source.slug,
        },
        result: execution,
      };
    }

    if (normalizedIntent === 'clarification') {
      return {
        mode: 'clarification',
        tool_call: {
          tool: 'agent.clarification',
        },
        result: {
          clarification_question: 'Please provide the vault address, pipeline slug, or query objective to proceed.',
        },
      };
    }

    if (normalizedIntent === 'analyze') {
      const agentResult = await this.agentService.ask(question, {
        ...options,
        auto_execute: false,
      });
      return {
        mode: 'analyze',
        tool_call: {
          tool: 'semantic.analyze',
        },
        result: agentResult,
      };
    }

    const queryResult = await this.agentService.ask(question, options);
    return {
      mode: 'query',
      tool_call: {
        tool: 'semantic.query',
      },
      result: queryResult,
    };
  }

  async sendSessionMessage(sessionId, input = {}) {
    const session = this.getChatSession(sessionId);
    const question = String(input.message || input.question || '').trim();
    if (!question) {
      throw createChatError('message is required', 'INVALID_MESSAGE', 400);
    }

    const options = this.normalizeChatOptions(asObject(input.options, {}), session.auto_execute !== false);
    const intent = inferIntent(question, input.intent);
    const toolInput = asObject(input.tool_input, {});
    const confirmToken = String(input.confirm_token || '').trim();

    const userMessage = this.database.createAgentChatMessage({
      id: crypto.randomUUID(),
      session_id: session.id,
      role: 'user',
      content: question,
      payload: {
        intent,
        tool_input: toolInput,
        options,
      },
      status: 'completed',
    });

    this.emitSessionEvent(session.id, 'turn_started', {
      message_id: userMessage.id,
      intent,
      question,
    });

    let assistantMessage = null;
    let turn = null;

    try {
      const execution = await this.executeIntent({
        sessionId: session.id,
        question,
        intent,
        toolInput,
        options,
        confirmToken,
      });

      this.emitSessionEvent(session.id, 'tool_call', {
        message_id: userMessage.id,
        tool_call: execution.tool_call,
      });

      let assistantStatus = 'completed';
      let assistantContent = `Intent ${execution.mode} completed.`;
      if (execution?.result?.requires_confirmation) {
        assistantStatus = 'requires_confirmation';
        assistantContent = 'Confirmation required before executing destructive action.';
      }

      assistantMessage = this.database.createAgentChatMessage({
        id: crypto.randomUUID(),
        session_id: session.id,
        role: 'assistant',
        content: assistantContent,
        payload: {
          mode: execution.mode,
          tool_call: execution.tool_call,
          result: execution.result,
        },
        status: assistantStatus,
      });

      turn = {
        mode: execution.mode,
        intent,
        tool_call: execution.tool_call,
        result: execution.result,
      };

      this.emitSessionEvent(session.id, 'tool_result', {
        message_id: assistantMessage.id,
        tool_call: execution.tool_call,
        result: execution.result,
      });

      this.emitSessionEvent(session.id, 'turn_completed', {
        message_id: assistantMessage.id,
        mode: execution.mode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assistantMessage = this.database.createAgentChatMessage({
        id: crypto.randomUUID(),
        session_id: session.id,
        role: 'assistant',
        content: `Error: ${message}`,
        payload: {
          error: {
            code: error?.code || 'AGENT_CHAT_ERROR',
            message,
            details: error?.details || null,
          },
          intent,
        },
        status: 'failed',
      });

      this.emitSessionEvent(session.id, 'turn_failed', {
        message_id: assistantMessage.id,
        error: {
          code: error?.code || 'AGENT_CHAT_ERROR',
          message,
          details: error?.details || null,
        },
      }, 'error');

      throw error;
    }

    return {
      session: this.getChatSession(session.id),
      user_message: userMessage,
      assistant_message: assistantMessage,
      turn,
    };
  }

  async runStatelessCompletion(input = {}) {
    const question = String(input.message || input.question || '').trim();
    if (!question) {
      throw createChatError('message is required', 'INVALID_MESSAGE', 400);
    }

    const options = this.normalizeChatOptions(asObject(input.options, {}), true);
    const intent = inferIntent(question, input.intent);
    const toolInput = asObject(input.tool_input, {});

    const execution = await this.executeIntent({
      sessionId: '',
      question,
      intent,
      toolInput,
      options,
      confirmToken: '',
    });

    return {
      request_id: crypto.randomUUID(),
      stateless: true,
      question,
      intent,
      mode: execution.mode,
      tool_call: execution.tool_call,
      result: execution.result,
    };
  }
}

export {
  FRONTEND_AGENT_ID,
  PIPELINE_LIFECYCLE_MODES,
  AGENT_OPERATION_MODES,
};
