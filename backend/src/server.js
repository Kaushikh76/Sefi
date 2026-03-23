import crypto from 'crypto';
import express from 'express';
import { createConfig } from './config.js';
import { SeFiDatabase } from './database.js';
import { SeFiIndexer } from './indexer.js';
import { ModelingService } from './modeling.js';
import { ModelingAiService } from './modeling-ai.js';
import { SeFiAgentService } from './agent-service.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { resolveCubeAuthToken } from './cube-auth.js';
import { executeCubeQueryWithRetry, normalizeCubeSqlPayload } from './cube-proxy.js';
import { RealtimeHub } from './realtime.js';
import {
  materializeQueryTemplate,
  resolveRuntimeParams,
  validateEndpointDefinition,
} from './custom-api.js';

function log(level, event, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

function sendError(res, req, status, code, message, details = null) {
  res.status(status).json({
    request_id: req.requestId,
    error: {
      code,
      message,
      details,
    },
  });
}

function createHttpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function parsePositiveInt(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;
  if (parsed > max) return fallback;
  return parsed;
}

function parsePositiveIntStrict(value, { fieldName, min, max, defaultValue }) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw createHttpError(
      400,
      'INVALID_INTEGER',
      `${fieldName} must be an integer between ${min} and ${max}`
    );
  }
  return parsed;
}

function isUniqueConstraintError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code.includes('SQLITE_CONSTRAINT_UNIQUE')) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique constraint');
}

function getAccessToken(req) {
  const direct = req.headers['x-sefi-api-token'];
  if (typeof direct === 'string' && direct.trim() !== '') {
    return direct.trim();
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
      return bearerMatch[1].trim();
    }
  }

  return '';
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;

  const pairs = String(header).split(';');
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const {
    maxAgeSeconds = null,
    httpOnly = true,
    sameSite = 'Lax',
    secure = false,
    path = '/',
  } = options;

  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds !== null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  if (path) {
    parts.push(`Path=${path}`);
  }
  if (httpOnly) {
    parts.push('HttpOnly');
  }
  if (sameSite) {
    parts.push(`SameSite=${sameSite}`);
  }
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function buildHederaTopicExplorerUrl(network, topicId) {
  const normalizedNetwork = String(network || 'mainnet').trim().toLowerCase();
  const encodedTopicId = encodeURIComponent(String(topicId || '').trim());
  if (!encodedTopicId) return '';
  if (normalizedNetwork === 'testnet') return `https://hashscan.io/testnet/topic/${encodedTopicId}`;
  if (normalizedNetwork === 'previewnet') return `https://hashscan.io/previewnet/topic/${encodedTopicId}`;
  return `https://hashscan.io/mainnet/topic/${encodedTopicId}`;
}

function parseScheduleIntervalMinutes(schedule) {
  if (!schedule || typeof schedule !== 'object') return 0;
  const directInterval = parsePositiveInt(schedule.interval_minutes ?? schedule.intervalMinutes, 0, 1, 24 * 60);
  if (directInterval > 0) return directInterval;

  const cron = String(schedule.cron || '').trim();
  if (!cron) return 0;

  const everyMinuteMatch = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (everyMinuteMatch) {
    return parsePositiveInt(everyMinuteMatch[1], 0, 1, 24 * 60);
  }

  const everyHourMatch = cron.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (everyHourMatch) {
    const hours = parsePositiveInt(everyHourMatch[1], 0, 1, 24);
    return hours > 0 ? hours * 60 : 0;
  }

  return 0;
}

function normalizeAgentOptions(rawOptions) {
  if (rawOptions === undefined || rawOptions === null) {
    return {};
  }
  if (typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
    throw createHttpError(400, 'INVALID_OPTIONS', 'options must be an object');
  }

  const allowedKeys = ['auto_execute', 'strong_model', 'allow_sql_fallback', 'max_rows'];
  const unexpected = Object.keys(rawOptions).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    throw createHttpError(400, 'INVALID_OPTIONS', `Unsupported options: ${unexpected.join(', ')}`);
  }

  return {
    auto_execute: parseBooleanFlag(rawOptions.auto_execute, undefined),
    strong_model: parseBooleanFlag(rawOptions.strong_model, false),
    allow_sql_fallback: parseBooleanFlag(rawOptions.allow_sql_fallback, undefined),
    max_rows: parsePositiveInt(rawOptions.max_rows, undefined, 1, 2000),
  };
}

function ensureRequestBodyObject(req) {
  if (req.body === undefined || req.body === null) return {};
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object');
  }
  return req.body;
}

function mapKnownError(error) {
  if (!error || typeof error !== 'object') {
    return createHttpError(500, 'INTERNAL_ERROR', 'Unexpected server error');
  }

  if (Number.isInteger(error.status)) {
    return error;
  }

  const code = String(error.code || '').toUpperCase();
  if (code === 'NOT_FOUND') {
    error.status = 404;
    return error;
  }

  if (code === 'STALE_PREVIEW') {
    error.status = 409;
    return error;
  }

  if (
    [
      'INVALID_PATH',
      'INVALID_CONTENT',
      'INVALID_MODEL_PATH',
      'INVALID_SQL',
      'INVALID_OPTIONS',
      'INVALID_PREVIEW_ID',
      'INVALID_QUESTION',
      'INVALID_PLAN',
      'PLAN_VALIDATION_FAILED',
      'INVALID_CUBE_QUERY',
      'INVALID_REQUEST_BODY',
      'INVALID_INTENT',
      'INVALID_DRAFT',
      'INVALID_RUNTIME_PARAMS',
      'INVALID_ENDPOINT_DEFINITION',
      'INVALID_AGENT_TYPE',
      'INVALID_AGENT_NAME',
      'INVALID_ENV_REF',
      'INVALID_AGENT_TOPIC',
      'MISSING_ENV_REFS',
      'AUTONOMOUS_NETWORK_BLOCKED',
    ].includes(code)
  ) {
    error.status = 400;
    return error;
  }

  if (code === 'ELIZA_REQUEST_FAILED') {
    error.status = 502;
    return error;
  }

  return error;
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const normalizedError = mapKnownError(error);
      const status = Number.isInteger(normalizedError?.status) ? normalizedError.status : 500;
      const code = normalizedError?.code || 'INTERNAL_ERROR';
      const details = normalizedError?.details || null;
      log('error', 'request_failed', {
        request_id: req.requestId,
        path: req.path,
        method: req.method,
        status,
        code,
        message: normalizedError?.message || 'Unexpected error',
      });
      sendError(res, req, status, code, normalizedError?.message || 'Unexpected server error', details);
    }
  };
}

async function main() {
  const config = createConfig();

  const database = new SeFiDatabase(config);
  await database.init();

  if (database.recoveryInfo) {
    log('warn', 'database_recovered_from_corruption', {
      reason: database.recoveryInfo.reason,
      original_path: database.recoveryInfo.originalPath,
      backup_path: database.recoveryInfo.backupPath,
      recovered_at: database.recoveryInfo.recoveredAt,
    });
  }

  const indexer = new SeFiIndexer({ config, database });
  const modelingService = new ModelingService({ config, database });
  const modelingAiService = new ModelingAiService({ config, database, modelingService });
  const agentService = new SeFiAgentService({ config, database });
  const agentOrchestrator = new AgentOrchestrator({ config, database, indexer, agentService });
  const realtimeHub = new RealtimeHub({
    heartbeatMs: Math.max(1000, Number(config.statusStreamHeartbeatMs) || 15000),
  });
  const scheduledAgentRuns = new Map();
  let agentSchedulerTimer = null;
  let agentSchedulerRunning = false;

  try {
    const bootstrap = agentOrchestrator.ensureBonzoClmmGuardAgent();
    if (bootstrap.created) {
      database.logActivity('agent_bootstrap', bootstrap.agent.id, `Bootstrapped ${bootstrap.agent.name}`);
      log('info', 'agent_bootstrapped', { agent_id: bootstrap.agent.id, name: bootstrap.agent.name });
    }
  } catch (error) {
    log('warn', 'agent_bootstrap_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    indexer.refreshManifests();
  } catch (error) {
    database.logActivity('manifest_error', null, error.message);
    log('warn', 'manifest_refresh_failed', { message: error.message });
  }

  async function runScheduledAgentTick() {
    if (agentSchedulerRunning) return;
    agentSchedulerRunning = true;

    try {
      const agents = agentOrchestrator.listAgents();
      const now = Date.now();

      for (const agent of agents) {
        const schedule = agent?.schedule && typeof agent.schedule === 'object' ? agent.schedule : {};
        if (schedule.enabled !== true) continue;

        const intervalMinutes = parseScheduleIntervalMinutes(schedule);
        if (intervalMinutes <= 0) continue;

        const intervalMs = intervalMinutes * 60 * 1000;
        const lastInMemory = Number(scheduledAgentRuns.get(agent.id) || 0);
        const lastPersisted = Date.parse(String(agent.last_run_at || '')) || 0;
        const referenceTs = Math.max(lastInMemory, lastPersisted);
        if (referenceTs > 0 && now - referenceTs < intervalMs) {
          continue;
        }

        scheduledAgentRuns.set(agent.id, now);
        try {
          const result = await agentOrchestrator.runScheduledAutomation(agent.id);
          database.logActivity(
            'agent_schedule_run',
            agent.id,
            `Scheduled automation completed (${schedule.action || 'publish_test'})`
          );
          log('info', 'agent_schedule_run', {
            agent_id: agent.id,
            action: schedule.action || 'publish_test',
            success: result?.success ?? true,
            summary: result?.summary || null,
          });
        } catch (error) {
          database.logActivity('agent_schedule_error', agent.id, error.message);
          log('warn', 'agent_schedule_error', {
            agent_id: agent.id,
            action: schedule.action || 'publish_test',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      agentSchedulerRunning = false;
    }
  }

  const app = express();
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    res.setHeader('Access-Control-Expose-Headers', 'x-request-id');
    req._requestStart = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - req._requestStart;
      log('info', 'request_complete', {
        request_id: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: durationMs,
      });
    });
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      sendError(res, req, 400, 'INVALID_JSON', 'Malformed JSON request body');
      return;
    }
    next(error);
  });

  app.use('/api/v1', (req, res, next) => {
    const origin = req.headers.origin ? String(req.headers.origin) : '';
    const allowAllOrigins = config.allowedOrigins.includes('*');
    const allowCredentials = Boolean(config.apiToken);

    if (allowAllOrigins) {
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
    } else if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    } else if (origin && !config.allowedOrigins.includes(origin)) {
      return sendError(res, req, 403, 'ORIGIN_NOT_ALLOWED', `Origin not allowed: ${origin}`);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-sefi-api-token,x-request-id');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  const authEnabled = Boolean(config.apiToken);
  const sessionCookieName = config.sessionCookieName || 'sefi_session';
  const sessionTtlSeconds = Math.max(300, Number(config.sessionTtlSeconds) || 43200);
  const sessionSecureCookie = Boolean(config.sessionSecureCookie || parseBooleanEnv(process.env.SEFI_SESSION_SECURE_COOKIE, false));
  const sessionStore = new Map();

  function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of sessionStore.entries()) {
      if (!session || session.expiresAt <= now) {
        sessionStore.delete(sessionId);
      }
    }
  }

  function createSession() {
    const now = Date.now();
    const expiresAt = now + (sessionTtlSeconds * 1000);
    const sessionId = crypto.randomUUID();
    sessionStore.set(sessionId, {
      createdAt: now,
      expiresAt,
    });
    return {
      sessionId,
      expiresAt,
    };
  }

  function clearSession(req, res) {
    const cookies = parseCookies(req);
    const existingId = cookies[sessionCookieName];
    if (existingId) {
      sessionStore.delete(existingId);
    }

    res.setHeader('Set-Cookie', serializeCookie(sessionCookieName, '', {
      maxAgeSeconds: 0,
      httpOnly: true,
      sameSite: 'Lax',
      secure: sessionSecureCookie,
      path: '/',
    }));
  }

  function getSessionFromRequest(req) {
    cleanupExpiredSessions();
    const cookies = parseCookies(req);
    const sessionId = cookies[sessionCookieName];
    if (!sessionId) return null;

    const session = sessionStore.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessionStore.delete(sessionId);
      return null;
    }

    return {
      id: sessionId,
      ...session,
    };
  }

  app.post('/api/v1/auth/session', route(async (req, res) => {
    if (!authEnabled) {
      const session = createSession();
      res.setHeader('Set-Cookie', serializeCookie(sessionCookieName, session.sessionId, {
        maxAgeSeconds: sessionTtlSeconds,
        httpOnly: true,
        sameSite: 'Lax',
        secure: sessionSecureCookie,
        path: '/',
      }));
      res.json({
        success: true,
        auth_mode: 'open',
        expires_at: new Date(session.expiresAt).toISOString(),
      });
      return;
    }

    const body = ensureRequestBodyObject(req);
    const bodyToken = typeof body.token === 'string' ? body.token.trim() : '';
    const headerToken = getAccessToken(req);
    const providedToken = bodyToken || headerToken;
    if (!providedToken || providedToken !== config.apiToken) {
      sendError(res, req, 401, 'UNAUTHORIZED', 'Missing or invalid API token');
      return;
    }

    const session = createSession();
    res.setHeader('Set-Cookie', serializeCookie(sessionCookieName, session.sessionId, {
      maxAgeSeconds: sessionTtlSeconds,
      httpOnly: true,
      sameSite: 'Lax',
      secure: sessionSecureCookie,
      path: '/',
    }));

    res.json({
      success: true,
      auth_mode: 'token_session',
      expires_at: new Date(session.expiresAt).toISOString(),
    });
  }));

  app.post('/api/v1/auth/logout', route(async (req, res) => {
    clearSession(req, res);
    res.json({ success: true });
  }));

  app.use('/api/v1', (req, res, next) => {
    if (!authEnabled) {
      next();
      return;
    }

    if (req.path === '/health' || req.path === '/auth/session' || req.path === '/auth/logout') {
      next();
      return;
    }

    const token = getAccessToken(req);
    if (token && token === config.apiToken) {
      next();
      return;
    }

    const session = getSessionFromRequest(req);
    if (session) {
      req.session = session;
      next();
      return;
    }

    sendError(res, req, 401, 'UNAUTHORIZED', 'Missing or invalid authentication');
  });

  function resolveCubeReadyUrl(cubeApiUrl) {
    const parsed = new URL(cubeApiUrl);
    parsed.pathname = '/readyz';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  const cubeReadyUrl = resolveCubeReadyUrl(config.cubeApiUrl);
  const backendStartedAtMs = Date.now();
  let backendLastOkAtMs = backendStartedAtMs;

  const cubeProbeState = {
    status: 'starting',
    http_status: 0,
    latency_ms: null,
    cube_api_url: config.cubeApiUrl,
    source: 'readyz_worker',
    timeout_ms: config.cubeHealthTimeoutMs,
    error: null,
    checked_at: null,
    checked_at_ms: 0,
    last_ok_at: null,
    last_ok_at_ms: 0,
    consecutive_failures: 0,
    next_probe_at: null,
  };

  let cubeProbeTimer = null;
  let cubeProbeRunning = false;
  let dbProbeTimer = null;
  const sessionCleanupTimer = setInterval(cleanupExpiredSessions, 60000);
  if (typeof sessionCleanupTimer.unref === 'function') {
    sessionCleanupTimer.unref();
  }

  function computeJitter(baseMs) {
    const jitterMax = Math.max(0, Number(config.cubeProbeJitterMs) || 0);
    if (jitterMax === 0) return baseMs;
    return baseMs + Math.floor(Math.random() * jitterMax);
  }

  function scheduleNextCubeProbe(delayMs) {
    if (cubeProbeTimer) {
      clearTimeout(cubeProbeTimer);
    }

    const safeDelay = Math.max(250, Math.floor(delayMs));
    cubeProbeState.next_probe_at = new Date(Date.now() + safeDelay).toISOString();
    cubeProbeTimer = setTimeout(() => {
      runCubeProbe().catch((error) => {
        log('warn', 'cube_health_probe_unhandled_error', { error: error.message });
      });
    }, safeDelay);
    if (typeof cubeProbeTimer.unref === 'function') {
      cubeProbeTimer.unref();
    }
  }

  async function runCubeProbe() {
    if (cubeProbeRunning) return;
    cubeProbeRunning = true;

    const startedAt = Date.now();
    const timeoutMs = config.cubeHealthTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Cube health probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const response = await fetch(cubeReadyUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      cubeProbeState.checked_at = new Date().toISOString();
      cubeProbeState.checked_at_ms = Date.now();
      cubeProbeState.http_status = response.status;
      cubeProbeState.latency_ms = latencyMs;
      cubeProbeState.error = null;

      if (response.ok) {
        cubeProbeState.status = 'up';
        cubeProbeState.last_ok_at = cubeProbeState.checked_at;
        cubeProbeState.last_ok_at_ms = cubeProbeState.checked_at_ms;
        cubeProbeState.consecutive_failures = 0;
      } else {
        cubeProbeState.status = 'degraded';
        cubeProbeState.consecutive_failures += 1;
        cubeProbeState.error = `readyz returned ${response.status}`;
      }

      log(response.ok ? 'info' : 'warn', 'cube_health_probe', {
        source: cubeProbeState.source,
        status: cubeProbeState.status,
        http_status: cubeProbeState.http_status,
        latency_ms: latencyMs,
        consecutive_failures: cubeProbeState.consecutive_failures,
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const timedOut = error?.name === 'AbortError';
      cubeProbeState.checked_at = new Date().toISOString();
      cubeProbeState.checked_at_ms = Date.now();
      cubeProbeState.status = 'down';
      cubeProbeState.http_status = 0;
      cubeProbeState.latency_ms = latencyMs;
      cubeProbeState.error = timedOut ? `timeout after ${timeoutMs}ms` : error.message;
      cubeProbeState.consecutive_failures += 1;

      log('warn', 'cube_health_probe', {
        source: cubeProbeState.source,
        status: cubeProbeState.status,
        latency_ms: latencyMs,
        timed_out: timedOut,
        consecutive_failures: cubeProbeState.consecutive_failures,
        error: cubeProbeState.error,
      });
    } finally {
      clearTimeout(timeout);
      cubeProbeRunning = false;

      const failureThreshold = Math.max(1, Number(config.cubeProbeFailureThreshold) || 3);
      const baseInterval =
        cubeProbeState.consecutive_failures >= failureThreshold
          ? Number(config.cubeProbeFailureIntervalMs) || 12000
          : Number(config.cubeProbeBaseIntervalMs) || 4000;
      scheduleNextCubeProbe(computeJitter(baseInterval));
    }
  }

  function getCubeHealthSnapshot() {
    const now = Date.now();
    const checkedAtMs = cubeProbeState.checked_at_ms || 0;
    const probeAgeMs = checkedAtMs ? Math.max(0, now - checkedAtMs) : null;

    let status = cubeProbeState.status || 'starting';
    let error = cubeProbeState.error || null;

    if (status === 'up' && probeAgeMs !== null && probeAgeMs > Math.max(config.statusStaleAfterMs, config.cubeProbeFailureIntervalMs * 2)) {
      status = 'degraded';
      error = error || `cube probe stale (${probeAgeMs}ms old)`;
    }

    return {
      status,
      http_status: cubeProbeState.http_status,
      latency_ms: cubeProbeState.latency_ms,
      cube_api_url: cubeProbeState.cube_api_url,
      source: cubeProbeState.source,
      timeout_ms: cubeProbeState.timeout_ms,
      error,
      checked_at: cubeProbeState.checked_at,
      last_ok_at: cubeProbeState.last_ok_at,
      consecutive_failures: cubeProbeState.consecutive_failures,
      next_probe_at: cubeProbeState.next_probe_at,
      probe_age_ms: probeAgeMs,
    };
  }

  function runDbProbe() {
    const result = database.probeReadiness();
    if (result.ok) {
      backendLastOkAtMs = Date.now();
      log('info', 'db_read_probe', {
        status: 'up',
        duration_ms: result.duration_ms,
      });
    } else {
      log('warn', 'db_read_probe', {
        status: 'degraded',
        duration_ms: result.duration_ms,
        error: result.error,
      });
    }
  }

  function deriveBackendStatus(dbStatus) {
    if (dbStatus === 'up') return 'up';
    if (dbStatus === 'starting') return 'starting';
    if (dbStatus === 'degraded') return 'degraded';
    return 'down';
  }

  function buildStatusSnapshot(source = 'snapshot') {
    const runtimeStatus = indexer.getRuntimeStatus();
    const metrics = database.getStatusMetrics();
    const readTelemetry = database.getReadTelemetry();
    const persistence = database.getPersistenceStatus();
    const cubeHealth = getCubeHealthSnapshot();
    const backendStatus = deriveBackendStatus(readTelemetry.db_status);

    if (backendStatus === 'up') {
      backendLastOkAtMs = Date.now();
    }

    return {
      ...runtimeStatus,
      protocol: config.protocolName,
      uptime_seconds: process.uptime(),
      timestamp: new Date().toISOString(),
      source,
      status_age_ms: Number(metrics.status_age_ms) || 0,
      backend_status: backendStatus,
      db_status: readTelemetry.db_status,
      cube_status: cubeHealth.status,
      backend_last_ok_at: new Date(backendLastOkAtMs).toISOString(),
      cube_last_ok_at: cubeHealth.last_ok_at || null,
      db_last_read_ok_at: readTelemetry.db_last_read_ok_at,
      db_last_read_error: readTelemetry.db_last_read_error,
      db_last_read_error_at: readTelemetry.db_last_read_error_at,
      db_last_read_duration_ms: readTelemetry.db_last_read_duration_ms,
      records_indexed: metrics.records_indexed,
      database: metrics.database,
      stats: metrics.stats,
      persistence,
      cube: cubeHealth,
      cube_health: cubeHealth,
    };
  }

  runDbProbe();
  dbProbeTimer = setInterval(runDbProbe, Math.max(500, Number(config.statusProbeIntervalMs) || 3000));
  if (typeof dbProbeTimer.unref === 'function') {
    dbProbeTimer.unref();
  }
  runCubeProbe().catch((error) => {
    log('warn', 'initial_cube_probe_failed', { error: error.message });
  });

  async function fetchWithTimeout(url, init = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function cubeHeaders(contentType = null) {
    const headers = {
      Accept: 'application/json',
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const cubeAuth = resolveCubeAuthToken(config.cubeApiToken);
    if (cubeAuth.token) {
      headers.Authorization = `Bearer ${cubeAuth.token}`;
      headers['x-cubejs-api-token'] = cubeAuth.token;
    }

    return headers;
  }

  async function fetchCubeMetaOrThrow() {
    const cubeHealth = getCubeHealthSnapshot();
    if (cubeHealth.status !== 'up') {
      throw createHttpError(503, 'CUBE_UNAVAILABLE', 'Cube service is not ready for metadata requests', cubeHealth);
    }

    const response = await fetchWithTimeout(
      `${config.cubeApiUrl}/meta`,
      {
        method: 'GET',
        headers: cubeHeaders(),
      },
      Math.max(1000, config.cubeHealthTimeoutMs * 2)
    );

    const payload = await response.json();
    if (!response.ok) {
      throw createHttpError(502, 'CUBE_META_FAILED', payload?.error || 'Cube meta request failed', payload);
    }
    return payload;
  }

  async function runCubeQueryOrThrow(query, queryType) {
    const safeQueryType = queryType === 'sql' ? 'sql' : 'load';
    const cubeHealth = getCubeHealthSnapshot();
    if (cubeHealth.status !== 'up') {
      throw createHttpError(503, 'CUBE_UNAVAILABLE', 'Cube service is not ready for query execution', cubeHealth);
    }

    return executeCubeQueryWithRetry({
      fetchImpl: fetch,
      cubeApiUrl: config.cubeApiUrl,
      queryType: safeQueryType,
      query,
      headers: cubeHeaders('application/json'),
      maxAttempts: 8,
      baseDelayMs: 250,
      maxDelayMs: 1500,
      jitterMs: 125,
      timeoutMs: Math.max(1000, config.cubeHealthTimeoutMs * 2),
    });
  }

  function runInBackground(taskName, runTask) {
    runTask().catch((error) => {
      database.logActivity('background_error', taskName, error.message);
      indexer.emit('error', { type: taskName, error: error.message });
      log('error', 'background_task_failed', {
        task: taskName,
        message: error.message,
      });
    });
  }

  indexer.onEvent((event, data) => {
    realtimeHub.publish('index', String(event || 'index_event'), data || {});
  });

  const originalLogActivity = database.logActivity.bind(database);
  database.logActivity = (eventType, entityName, message) => {
    originalLogActivity(eventType, entityName, message);
    realtimeHub.publish('activity', 'activity_log', {
      event_type: String(eventType || ''),
      entity_name: entityName || null,
      message: String(message || ''),
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/api/v1/health', route(async (req, res) => {
    const snapshot = buildStatusSnapshot('health');
    const backendHealthy = snapshot.backend_status === 'up' || snapshot.backend_status === 'degraded' || snapshot.backend_status === 'starting';
    res.status(backendHealthy ? 200 : 503).json({
      status: backendHealthy ? 'ok' : 'degraded',
      protocol: snapshot.protocol,
      network: snapshot.network,
      networks: snapshot.networks,
      uptime_seconds: snapshot.uptime_seconds,
      timestamp: snapshot.timestamp,
      backend_status: snapshot.backend_status,
      db_status: snapshot.db_status,
      cube_status: snapshot.cube_status,
      backend_last_ok_at: snapshot.backend_last_ok_at,
      cube_last_ok_at: snapshot.cube_last_ok_at,
      db_last_read_ok_at: snapshot.db_last_read_ok_at,
      db_last_read_error: snapshot.db_last_read_error,
      source: snapshot.source,
      status_age_ms: snapshot.status_age_ms,
      cube: snapshot.cube,
      cube_health: snapshot.cube_health,
    });
  }));

  app.get('/api/v1/status', route(async (req, res) => {
    res.json(buildStatusSnapshot('status'));
  }));

  app.get('/api/v1/status/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const sendSnapshot = () => {
      try {
        res.write(`data: ${JSON.stringify(buildStatusSnapshot('stream'))}\n\n`);
      } catch {
        // ignore disconnected streams
      }
    };

    sendSnapshot();

    const updateInterval = Math.max(500, Number(config.statusStreamIntervalMs) || 3000);
    const heartbeatInterval = Math.max(1000, Number(config.statusStreamHeartbeatMs) || 15000);
    const ticker = setInterval(sendSnapshot, updateInterval);
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // ignore disconnected streams
      }
    }, heartbeatInterval);

    req.on('close', () => {
      clearInterval(ticker);
      clearInterval(heartbeat);
      res.end();
    });
  });

  app.get('/api/v1/realtime/stream', (req, res) => {
    realtimeHub.subscribe(req, res, req.query.channels ? String(req.query.channels) : '');
  });

  app.get('/api/v1/metrics/overview', route(async (req, res) => {
    res.json(database.getOverview());
  }));

  app.get('/api/v1/contracts/progress', route(async (req, res) => {
    const records = database.getContractsProgress();
    res.json({
      count: records.length,
      records,
    });
  }));

  app.get('/api/v1/records/recent', route(async (req, res) => {
    const type = String(req.query.type || 'contract_logs');
    const limit = parsePositiveInt(req.query.limit, 50, 1, 500);

    const supportedTypes = ['contract_logs', 'hts_transfers', 'topic_messages', 'erc20_transfers'];
    if (!supportedTypes.includes(type)) {
      sendError(res, req, 400, 'INVALID_RECORD_TYPE', 'Unsupported record type', {
        supported_types: supportedTypes,
      });
      return;
    }

    const records = database.getRecentRecords(type, limit);
    res.json({
      type,
      count: records.length,
      records,
    });
  }));

  app.post('/api/v1/index/sync', route(async (req, res) => {
    if (indexer.getRuntimeStatus().isRunning) {
      sendError(res, req, 409, 'INDEXER_BUSY', 'Indexer is already running');
      return;
    }

    runInBackground('sync', async () => {
      await indexer.startSync();
    });

    res.json({
      success: true,
      message: 'Sync started (one-time backfill). Use listen mode for near-real-time polling.',
      mode: 'sync',
      target: 'all',
      continuous: false,
    });
  }));

  app.post('/api/v1/index/sync/contracts', route(async (req, res) => {
    if (indexer.getRuntimeStatus().isRunning) {
      sendError(res, req, 409, 'INDEXER_BUSY', 'Indexer is already running');
      return;
    }

    runInBackground('sync_contracts', async () => {
      await indexer.startSyncContracts();
    });

    res.json({
      success: true,
      message: 'Contracts sync started (one-time targeted backfill).',
      mode: 'sync',
      target: 'contracts',
      continuous: false,
    });
  }));

  app.post('/api/v1/index/sync/hts', route(async (req, res) => {
    if (indexer.getRuntimeStatus().isRunning) {
      sendError(res, req, 409, 'INDEXER_BUSY', 'Indexer is already running');
      return;
    }

    runInBackground('sync_hts', async () => {
      await indexer.startSyncHts();
    });

    res.json({
      success: true,
      message: 'HTS sync started (one-time targeted backfill).',
      mode: 'sync',
      target: 'hts',
      continuous: false,
    });
  }));

  app.post('/api/v1/index/sync/topics', route(async (req, res) => {
    if (indexer.getRuntimeStatus().isRunning) {
      sendError(res, req, 409, 'INDEXER_BUSY', 'Indexer is already running');
      return;
    }

    runInBackground('sync_topics', async () => {
      await indexer.startSyncTopics();
    });

    res.json({
      success: true,
      message: 'Topic sync started (one-time targeted backfill).',
      mode: 'sync',
      target: 'topics',
      continuous: false,
    });
  }));

  app.post('/api/v1/index/listen', route(async (req, res) => {
    if (indexer.getRuntimeStatus().isRunning) {
      sendError(res, req, 409, 'INDEXER_BUSY', 'Indexer is already running');
      return;
    }

    runInBackground('listen', async () => {
      await indexer.startListen();
    });

    res.json({
      success: true,
      message: 'Near-real-time polling started',
      mode: 'listen',
      target: 'listen',
      continuous: true,
      mechanism: 'polling',
    });
  }));

  app.post('/api/v1/index/stop', route(async (req, res) => {
    const result = indexer.stop();
    if (result?.error) {
      sendError(res, req, 409, 'INDEXER_NOT_RUNNING', result.error);
      return;
    }
    res.json(result);
  }));

  app.post('/api/v1/index/reset', route(async (req, res) => {
    if (indexer.getRuntimeStatus().isRunning) {
      sendError(res, req, 409, 'INDEXER_BUSY', 'Stop the indexer before resetting data');
      return;
    }

    const result = await database.resetIndexerData();
    res.json({
      ...result,
      message: 'Indexer data reset complete. Start a full sync to reindex from scratch.',
    });
  }));

  app.get('/api/v1/manifests', route(async (req, res) => {
    indexer.refreshManifests();
    res.json(indexer.getManifestSummary());
  }));

  app.get('/api/v1/activity', route(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 50, 1, 1000);
    res.json(database.getRecentActivity(limit));
  }));

  app.get('/api/v1/modeling/sqlite/schema', route(async (req, res) => {
    res.json(modelingService.getSqliteSchema());
  }));

  app.post('/api/v1/modeling/schema/preview', route(async (req, res) => {
    ensureRequestBodyObject(req);
    res.json(modelingService.buildPreview());
  }));

  app.post('/api/v1/modeling/schema/apply', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const previewId = body.preview_id;
    if (previewId !== undefined && previewId !== null && typeof previewId !== 'string') {
      sendError(res, req, 400, 'INVALID_PREVIEW_ID', 'preview_id must be a string when provided');
      return;
    }

    try {
      const result = modelingService.applyPreview(previewId || null);
      database.logActivity('schema_apply', null, `Applied generated schema files (${result.writes_applied} writes, ${result.removals_applied} removals)`);
      res.json(result);
    } catch (error) {
      if (error?.code === 'STALE_PREVIEW') {
        sendError(res, req, 409, 'STALE_PREVIEW', error.message, {
          preview_id: error.currentPreviewId || null,
        });
        return;
      }
      throw error;
    }
  }));

  app.get('/api/v1/modeling/models/status', route(async (req, res) => {
    res.json(modelingService.getModelStorageStatus());
  }));

  app.get('/api/v1/modeling/models', route(async (req, res) => {
    const scope = req.query.scope ? String(req.query.scope) : 'all';
    res.json(modelingService.listModelFiles(scope));
  }));

  app.get('/api/v1/modeling/models/content', route(async (req, res) => {
    const modelPath = req.query.path ? String(req.query.path) : '';
    res.json(modelingService.getModelFileContent(modelPath));
  }));

  app.put('/api/v1/modeling/models/content', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const modelPath = body.path ? String(body.path) : '';
    const content = body.content;

    if (!modelPath) {
      sendError(res, req, 400, 'INVALID_MODEL_PATH', 'path is required');
      return;
    }

    if (typeof content !== 'string') {
      sendError(res, req, 400, 'INVALID_CONTENT', 'content must be a string');
      return;
    }

    if (content.length > 2_000_000) {
      sendError(res, req, 400, 'INVALID_CONTENT', 'content is too large (max 2MB)');
      return;
    }

    const result = modelingService.upsertModelFile(modelPath, content);
    database.logActivity('model_save', modelPath, `Saved Cube model file (${result.created ? 'created' : 'updated'})`);
    res.json(result);
  }));

  app.delete('/api/v1/modeling/models/content', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const modelPath = body.path ? String(body.path) : '';

    if (!modelPath) {
      sendError(res, req, 400, 'INVALID_MODEL_PATH', 'path is required');
      return;
    }

    const result = modelingService.deleteModelFile(modelPath);
    database.logActivity('model_delete', modelPath, 'Deleted Cube model file');
    res.json(result);
  }));

  app.post('/api/v1/modeling/sqlite/query', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const sql = body.sql;
    const maxRows = parsePositiveIntStrict(body.max_rows, {
      fieldName: 'max_rows',
      min: 1,
      max: 2000,
      defaultValue: 200,
    });

    if (typeof sql !== 'string' || sql.trim() === '') {
      sendError(res, req, 400, 'INVALID_SQL', 'sql is required');
      return;
    }

    res.json(database.executeReadOnlyQuery(sql, { maxRows }));
  }));

  app.post('/api/v1/modeling/ai/generate', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const intent = body.intent ? String(body.intent) : '';
    const constraints = body.constraints ? String(body.constraints) : '';
    const targetPath = body.target_path ? String(body.target_path) : '';

    let cubeMeta = null;
    let cubeMetaSource = 'unavailable';
    try {
      cubeMeta = await fetchCubeMetaOrThrow();
      cubeMetaSource = 'cube';
    } catch (error) {
      cubeMeta = null;
      cubeMetaSource = `fallback:${error?.code || 'CUBE_META_UNAVAILABLE'}`;
    }

    const draft = await modelingAiService.generateDraft(
      {
        intent,
        constraints,
        targetPath,
      },
      cubeMeta
    );

    database.logActivity('model_ai_generate', draft.target_path, `Generated AI model draft ${draft.draft_id}`);
    realtimeHub.publish('api', 'model_ai_generate', {
      draft_id: draft.draft_id,
      target_path: draft.target_path,
      cube_meta_source: cubeMetaSource,
      status: draft.status,
    });

    res.status(201).json({
      draft,
      cube_meta_source: cubeMetaSource,
    });
  }));

  app.get('/api/v1/modeling/ai/drafts/:draftId', route(async (req, res) => {
    const draft = modelingAiService.getDraft(String(req.params.draftId || ''));
    res.json({
      draft,
    });
  }));

  app.post('/api/v1/modeling/ai/approve', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const draftId = body.draft_id ? String(body.draft_id) : '';
    const pathOverride = body.path ? String(body.path) : null;

    if (!draftId) {
      sendError(res, req, 400, 'INVALID_DRAFT', 'draft_id is required');
      return;
    }

    const approval = modelingAiService.approveDraft({
      draftId,
      pathOverride,
    });

    let cubeRefresh = null;
    try {
      const meta = await fetchCubeMetaOrThrow();
      cubeRefresh = {
        status: 'ok',
        cube_count: Array.isArray(meta?.cubes) ? meta.cubes.length : 0,
      };
    } catch (error) {
      cubeRefresh = {
        status: 'degraded',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    database.logActivity('model_ai_approve', approval.draft.target_path, `Approved AI model draft ${draftId}`);
    realtimeHub.publish('api', 'model_ai_approve', {
      draft_id: draftId,
      target_path: approval.draft.target_path,
      approved_path: approval.draft.approved_path,
      cube_refresh: cubeRefresh,
    });

    res.json({
      ...approval,
      cube_refresh: cubeRefresh,
    });
  }));

  app.get('/api/v1/apis', route(async (req, res) => {
    const records = database.listApiEndpoints();
    res.json({
      count: records.length,
      records,
    });
  }));

  app.post('/api/v1/apis', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const validation = validateEndpointDefinition(body, { partial: false });
    if (validation.errors.length > 0) {
      sendError(res, req, 400, 'INVALID_ENDPOINT_DEFINITION', 'API endpoint definition is invalid', {
        errors: validation.errors,
      });
      return;
    }

    try {
      const record = database.createApiEndpoint(validation.value);
      database.logActivity('api_endpoint_create', record.slug, `Created API endpoint ${record.slug}`);
      realtimeHub.publish('api', 'endpoint_created', {
        endpoint_id: record.id,
        slug: record.slug,
      });
      res.status(201).json(record);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        sendError(res, req, 409, 'ENDPOINT_SLUG_CONFLICT', 'API endpoint slug already exists');
        return;
      }
      throw error;
    }
  }));

  app.patch('/api/v1/apis/:apiId', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const endpointId = String(req.params.apiId || '');
    const validation = validateEndpointDefinition(body, { partial: true });
    if (validation.errors.length > 0) {
      sendError(res, req, 400, 'INVALID_ENDPOINT_DEFINITION', 'API endpoint update is invalid', {
        errors: validation.errors,
      });
      return;
    }

    try {
      const record = database.updateApiEndpoint(endpointId, validation.value);
      database.logActivity('api_endpoint_update', record.slug, `Updated API endpoint ${record.slug}`);
      realtimeHub.publish('api', 'endpoint_updated', {
        endpoint_id: record.id,
        slug: record.slug,
      });
      res.json(record);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        sendError(res, req, 409, 'ENDPOINT_SLUG_CONFLICT', 'API endpoint slug already exists');
        return;
      }
      throw error;
    }
  }));

  app.delete('/api/v1/apis/:apiId', route(async (req, res) => {
    const endpointId = String(req.params.apiId || '');
    const existing = database.getApiEndpointById(endpointId);
    if (!existing) {
      sendError(res, req, 404, 'NOT_FOUND', `API endpoint not found: ${endpointId}`);
      return;
    }

    database.deleteApiEndpoint(endpointId);
    database.logActivity('api_endpoint_delete', existing.slug, `Deleted API endpoint ${existing.slug}`);
    realtimeHub.publish('api', 'endpoint_deleted', {
      endpoint_id: endpointId,
      slug: existing.slug,
    });
    res.json({
      deleted: true,
      id: endpointId,
    });
  }));

  async function executeStoredApiEndpoint(req, res, endpoint) {
    if (!endpoint.enabled) {
      sendError(res, req, 409, 'ENDPOINT_DISABLED', `API endpoint is disabled: ${endpoint.slug}`);
      return;
    }

    const body = ensureRequestBodyObject(req);
    const queryType = body.queryType === 'sql' ? 'sql' : 'load';
    const runtime = resolveRuntimeParams(endpoint.params_schema, body.params || {});
    if (runtime.errors.length > 0) {
      sendError(res, req, 400, 'INVALID_RUNTIME_PARAMS', 'Endpoint runtime params are invalid', {
        errors: runtime.errors,
      });
      return;
    }

    const materializedQuery = materializeQueryTemplate(endpoint.query_template, runtime.values);

    try {
      const result = await runCubeQueryOrThrow(materializedQuery, queryType);
      database.recordApiEndpointRun(endpoint.id, 'success', null);
      database.logActivity('api_endpoint_run', endpoint.slug, `Executed API endpoint ${endpoint.slug}`);
      realtimeHub.publish('api', 'endpoint_executed', {
        endpoint_id: endpoint.id,
        slug: endpoint.slug,
        query_type: result.query_type,
        attempts: result.attempts,
      });

      res.json({
        endpoint: {
          id: endpoint.id,
          slug: endpoint.slug,
          name: endpoint.name,
        },
        query_type: queryType,
        params_used: runtime.values,
        param_warnings: runtime.warnings,
        query: materializedQuery,
        continue_wait_count: result.continue_wait_count,
        attempts: result.attempts,
        normalized_sql: queryType === 'sql' ? result.normalized_sql : null,
        payload: result.payload,
      });
    } catch (error) {
      database.recordApiEndpointRun(endpoint.id, 'failed', error instanceof Error ? error.message : String(error));
      database.logActivity('api_endpoint_run_failed', endpoint.slug, `API endpoint failed: ${endpoint.slug}`);
      realtimeHub.publish('api', 'endpoint_execution_failed', {
        endpoint_id: endpoint.id,
        slug: endpoint.slug,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  app.post('/api/v1/apis/:apiId/run', route(async (req, res) => {
    const endpointId = String(req.params.apiId || '');
    const endpoint = database.getApiEndpointById(endpointId);
    if (!endpoint) {
      sendError(res, req, 404, 'NOT_FOUND', `API endpoint not found: ${endpointId}`);
      return;
    }
    await executeStoredApiEndpoint(req, res, endpoint);
  }));

  app.post('/api/v1/endpoints/:slug', route(async (req, res) => {
    const slug = String(req.params.slug || '').trim();
    const endpoint = database.getApiEndpointBySlug(slug);
    if (!endpoint) {
      sendError(res, req, 404, 'NOT_FOUND', `API endpoint not found: ${slug}`);
      return;
    }
    await executeStoredApiEndpoint(req, res, endpoint);
  }));

  app.get('/api/v1/cube/health', route(async (req, res) => {
    res.json(getCubeHealthSnapshot());
  }));

  app.get('/api/v1/cube/meta', route(async (req, res) => {
    const payload = await fetchCubeMetaOrThrow();
    res.json(payload);
  }));

  app.post('/api/v1/cube/query', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const query = body.query;
    const queryType = body.queryType === 'sql' ? 'sql' : body.queryType === undefined ? 'load' : String(body.queryType);

    if (!query || typeof query !== 'object') {
      sendError(res, req, 400, 'INVALID_CUBE_QUERY', 'query object is required');
      return;
    }

    if (!['load', 'sql'].includes(queryType)) {
      sendError(res, req, 400, 'INVALID_CUBE_QUERY_TYPE', 'queryType must be either "load" or "sql"');
      return;
    }

    const result = await runCubeQueryOrThrow(query, queryType);
    if (result.query_type === 'sql') {
      const normalizedSql = result.normalized_sql || normalizeCubeSqlPayload(result.payload);
      res.json({
        query_type: result.query_type,
        attempts: result.attempts,
        continue_wait_count: result.continue_wait_count,
        normalized_sql: normalizedSql,
        payload: result.payload,
      });
      return;
    }

    res.json({
      query_type: result.query_type,
      attempts: result.attempts,
      continue_wait_count: result.continue_wait_count,
      payload: result.payload,
    });
  }));

  app.get('/api/v1/agents/templates', route(async (req, res) => {
    res.json({
      templates: agentOrchestrator.listBrainstormTemplates(),
    });
  }));

  app.post('/api/v1/agents/bootstrap/bonzo-clmm-guard', route(async (req, res) => {
    const result = agentOrchestrator.ensureBonzoClmmGuardAgent();
    database.logActivity(
      'agent_bootstrap',
      result.agent.id,
      result.created ? 'Bootstrapped Bonzo CLMM guard agent' : 'Bonzo CLMM guard agent already exists'
    );
    res.status(result.created ? 201 : 200).json(result);
  }));

  app.get('/api/v1/agents', route(async (req, res) => {
    const records = agentOrchestrator.listAgents();
    res.json({
      count: records.length,
      records,
    });
  }));

  app.get('/api/v1/agents/topics', route(async (req, res) => {
    const records = agentOrchestrator.listTopicRegistrations();
    const agentNameMap = new Map(agentOrchestrator.listAgents().map((agent) => [agent.id, agent.name]));

    res.json({
      count: records.length,
      records: records.map((record) => ({
        ...record,
        agent_name: agentNameMap.get(record.agent_id) || null,
        explorer_url: buildHederaTopicExplorerUrl(record.network, record.topic_id),
      })),
    });
  }));

  app.post('/api/v1/agents', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const created = agentOrchestrator.createAgent(body);
    database.logActivity('agent_create', created.id, `Created ${created.type} agent "${created.name}"`);
    res.status(201).json(created);
  }));

  app.get('/api/v1/agents/:agentId', route(async (req, res) => {
    const agent = agentOrchestrator.getAgent(String(req.params.agentId || ''));
    res.json(agent);
  }));

  app.patch('/api/v1/agents/:agentId', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const updated = agentOrchestrator.updateAgent(String(req.params.agentId || ''), body);
    database.logActivity('agent_update', updated.id, `Updated agent "${updated.name}"`);
    res.json(updated);
  }));

  app.delete('/api/v1/agents/:agentId', route(async (req, res) => {
    const agentId = String(req.params.agentId || '');
    const result = agentOrchestrator.deleteAgent(agentId);
    database.logActivity('agent_delete', agentId, 'Deleted agent');
    res.json(result);
  }));

  app.post('/api/v1/agents/:agentId/start', route(async (req, res) => {
    const agentId = String(req.params.agentId || '');
    const started = await agentOrchestrator.startAgent(agentId);
    database.logActivity('agent_start', agentId, `Started agent "${started.name}"`);
    res.json(started);
  }));

  app.post('/api/v1/agents/:agentId/stop', route(async (req, res) => {
    const agentId = String(req.params.agentId || '');
    const stopped = await agentOrchestrator.stopAgent(agentId);
    database.logActivity('agent_stop', agentId, `Stopped agent "${stopped.name}"`);
    res.json(stopped);
  }));

  app.get('/api/v1/agents/:agentId/activity', route(async (req, res) => {
    const agentId = String(req.params.agentId || '');
    const limit = parsePositiveInt(req.query.limit, 100, 1, 1000);
    const records = agentOrchestrator.getAgentActivity(agentId, limit);
    res.json({
      count: records.length,
      records,
    });
  }));

  app.get('/api/v1/agents/:agentId/runs', route(async (req, res) => {
    const agentId = String(req.params.agentId || '');
    const limit = parsePositiveInt(req.query.limit, 50, 1, 500);
    const records = agentOrchestrator.getAgentRuns(agentId, limit);
    res.json({
      count: records.length,
      records,
    });
  }));

  app.post('/api/v1/agents/:agentId/brainstorm', route(async (req, res) => {
    const agentId = String(req.params.agentId || '');
    const body = ensureRequestBodyObject(req);
    const result = await agentOrchestrator.applyBrainstorm(agentId, body);
    database.logActivity('agent_brainstorm', agentId, `Updated brainstorm template (${result.template.key})`);
    res.json(result);
  }));

  app.post('/api/v1/agents/:agentId/publish/test', route(async (req, res) => {
    const agentId = String(req.params.agentId || '');
    const body = ensureRequestBodyObject(req);
    const result = await agentOrchestrator.publishTest(agentId, body);
    database.logActivity('agent_publish_test', agentId, `Publish test ${result.success ? 'succeeded' : 'degraded'}`);
    res.json(result);
  }));

  app.get('/api/v1/agents/playground/context', route(async (req, res) => {
    const context = await agentService.getPlaygroundContext();
    res.json(context);
  }));

  app.post('/api/v1/agents/playground/ask', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const question = body.question;
    if (typeof question !== 'string' || question.trim() === '') {
      sendError(res, req, 400, 'INVALID_QUESTION', 'question is required');
      return;
    }

    const options = normalizeAgentOptions(body.options);
    const result = await agentService.ask(question, options);
    res.json(result);
  }));

  app.post('/api/v1/agents/playground/execute', route(async (req, res) => {
    const body = ensureRequestBodyObject(req);
    const plan = body.plan;
    if (!plan || typeof plan !== 'object') {
      sendError(res, req, 400, 'INVALID_PLAN', 'plan is required');
      return;
    }

    const options = normalizeAgentOptions(body.options);
    const result = await agentService.executePlan(plan, options);
    res.json(result);
  }));

  app.use('/api/v1', (req, res) => {
    sendError(res, req, 404, 'NOT_FOUND', `Endpoint not found: ${req.method} ${req.path}`);
  });

  agentSchedulerTimer = setInterval(() => {
    runScheduledAgentTick().catch((error) => {
      log('warn', 'agent_schedule_tick_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30000);
  if (typeof agentSchedulerTimer.unref === 'function') {
    agentSchedulerTimer.unref();
  }
  setTimeout(() => {
    runScheduledAgentTick().catch((error) => {
      log('warn', 'agent_schedule_tick_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 2500);

  const server = app.listen(config.port, () => {
    log('info', 'server_started', {
      port: config.port,
      network: config.network,
      cube_api_url: config.cubeApiUrl,
    });
  });

  const shutdown = () => {
    if (cubeProbeTimer) {
      clearTimeout(cubeProbeTimer);
      cubeProbeTimer = null;
    }
    if (dbProbeTimer) {
      clearInterval(dbProbeTimer);
      dbProbeTimer = null;
    }
    if (sessionCleanupTimer) {
      clearInterval(sessionCleanupTimer);
    }
    if (agentSchedulerTimer) {
      clearInterval(agentSchedulerTimer);
      agentSchedulerTimer = null;
    }
    realtimeHub.close();
    indexer.stop();
    server.close(async () => {
      try {
        await database.close();
      } finally {
        process.exit(0);
      }
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log('error', 'server_boot_failed', { message: error.message });
  process.exit(1);
});
