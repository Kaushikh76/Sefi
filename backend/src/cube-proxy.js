function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Cube request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
    },
  };
}

function createCubeProxyError({ status, code, message, details = null }) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function parseResponseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(payload) {
  if (typeof payload?.error === 'string') {
    return payload.error;
  }
  if (typeof payload?.error?.message === 'string') {
    return payload.error.message;
  }
  if (typeof payload?.message === 'string') {
    return payload.message;
  }
  return null;
}

export function isCubeContinueWait(payload) {
  const message = String(extractErrorMessage(payload) || '').trim().toLowerCase();
  if (!message) return false;
  return message === 'continue wait' || message.includes('continue wait');
}

export function normalizeCubeSqlPayload(payload) {
  const normalized = {
    status: 'unknown',
    query_type: null,
    sql_text: null,
    sql_params: null,
    error: null,
    warnings: [],
  };

  if (!payload || typeof payload !== 'object') {
    normalized.error = 'SQL planner payload is not an object';
    normalized.warnings.push('Missing SQL planner payload object');
    return normalized;
  }

  const sqlNode = payload.sql;
  const isTupleShape = Array.isArray(sqlNode);
  if (!sqlNode || (typeof sqlNode !== 'object' && !isTupleShape)) {
    normalized.error = extractErrorMessage(payload) || 'SQL planner payload does not include sql object';
    normalized.warnings.push('Missing sql object in Cube /sql response');
    return normalized;
  }

  const sqlTuple = isTupleShape ? sqlNode : sqlNode.sql;
  const sqlStatus = isTupleShape ? null : sqlNode.status;
  if (typeof sqlStatus === 'string' && sqlStatus.trim() !== '') {
    normalized.status = sqlStatus;
  } else if (Array.isArray(sqlTuple)) {
    // Older Cube shapes return tuple-only SQL without explicit planner status.
    normalized.status = 'ok';
  } else {
    normalized.warnings.push('sql.status missing in planner response');
  }

  const queryTypeCandidate = isTupleShape ? null : (sqlNode.query_type || sqlNode.queryType || null);
  if (typeof queryTypeCandidate === 'string' && queryTypeCandidate.trim() !== '') {
    normalized.query_type = queryTypeCandidate;
  }

  if (Array.isArray(sqlTuple)) {
    const [sqlText, sqlParams] = sqlTuple;
    if (typeof sqlText === 'string') {
      normalized.sql_text = sqlText;
    } else if (sqlText != null) {
      normalized.sql_text = String(sqlText);
      normalized.warnings.push('sql.sql[0] was not a string');
    }
    normalized.sql_params = sqlParams ?? null;
  } else if (sqlTuple != null) {
    normalized.warnings.push('sql.sql is present but not an array tuple');
  }

  normalized.error =
    (!isTupleShape && typeof sqlNode.error === 'string' && sqlNode.error) ||
    extractErrorMessage(payload) ||
    null;

  return normalized;
}

export async function executeCubeQueryWithRetry({
  fetchImpl = fetch,
  cubeApiUrl,
  queryType,
  query,
  headers,
  maxAttempts = 8,
  baseDelayMs = 250,
  maxDelayMs = 1500,
  jitterMs = 125,
  timeoutMs = 15000,
}) {
  if (!cubeApiUrl || typeof cubeApiUrl !== 'string') {
    throw createCubeProxyError({
      status: 500,
      code: 'CUBE_PROXY_CONFIG_ERROR',
      message: 'Cube API URL is not configured',
    });
  }

  const safeQueryType = queryType === 'sql' ? 'sql' : 'load';
  const safeMaxAttempts = Math.max(1, Math.min(Number(maxAttempts) || 1, 30));

  let continueWaitCount = 0;
  let lastPayload = null;

  for (let attempt = 1; attempt <= safeMaxAttempts; attempt += 1) {
    const request = withTimeoutSignal(Math.max(1000, Number(timeoutMs) || 15000));

    let response;
    try {
      response = await fetchImpl(`${cubeApiUrl}/${safeQueryType}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
        signal: request.signal,
      });
    } catch (error) {
      request.clear();
      if (attempt >= safeMaxAttempts) {
        throw createCubeProxyError({
          status: 502,
          code: 'CUBE_REQUEST_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const nextDelay = Math.min(baseDelayMs * attempt, maxDelayMs) + Math.floor(Math.random() * Math.max(0, jitterMs));
      await sleep(nextDelay);
      continue;
    }

    let payload = null;
    try {
      const text = await response.text();
      payload = parseResponseJsonSafe(text);
      if (payload == null) {
        payload = {
          error: text || `Cube ${safeQueryType} response is not valid JSON`,
        };
      }
    } finally {
      request.clear();
    }

    lastPayload = payload;

    if (!response.ok) {
      throw createCubeProxyError({
        status: 502,
        code: `CUBE_${safeQueryType.toUpperCase()}_FAILED`,
        message: extractErrorMessage(payload) || `Cube ${safeQueryType} request failed`,
        details: {
          http_status: response.status,
          payload,
        },
      });
    }

    if (isCubeContinueWait(payload)) {
      continueWaitCount += 1;
      if (attempt >= safeMaxAttempts) {
        throw createCubeProxyError({
          status: 504,
          code: 'CUBE_CONTINUE_WAIT_TIMEOUT',
          message: `Cube returned Continue wait ${continueWaitCount} time(s) for ${safeQueryType}`,
          details: {
            attempts: attempt,
            query_type: safeQueryType,
            payload,
          },
        });
      }

      const nextDelay = Math.min(baseDelayMs * attempt, maxDelayMs) + Math.floor(Math.random() * Math.max(0, jitterMs));
      await sleep(nextDelay);
      continue;
    }

    return {
      payload,
      attempts: attempt,
      continue_wait_count: continueWaitCount,
      query_type: safeQueryType,
      normalized_sql: safeQueryType === 'sql' ? normalizeCubeSqlPayload(payload) : null,
    };
  }

  throw createCubeProxyError({
    status: 500,
    code: 'CUBE_PROXY_UNREACHABLE',
    message: 'Cube proxy reached unexpected state',
    details: {
      query_type: safeQueryType,
      payload: lastPayload,
    },
  });
}
