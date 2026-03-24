import crypto from 'crypto';
import { resolveCubeAuthToken } from './cube-auth.js';

function createAgentError(message, status = 400, code = 'AGENT_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
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

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickOutputText(responsePayload) {
  if (typeof responsePayload?.output_text === 'string' && responsePayload.output_text.trim() !== '') {
    return responsePayload.output_text.trim();
  }

  if (!Array.isArray(responsePayload?.output)) {
    return null;
  }

  for (const outputItem of responsePayload.output) {
    if (!Array.isArray(outputItem?.content)) continue;
    for (const contentItem of outputItem.content) {
      const textCandidate = contentItem?.text || contentItem?.output_text || null;
      if (typeof textCandidate === 'string' && textCandidate.trim() !== '') {
        return textCandidate.trim();
      }
    }
  }

  return null;
}

function createResponseSchema() {
  return {
    name: 'sefi_semantic_agent_plan',
    strict: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: ['cube_query', 'clarification', 'sql_fallback'],
        },
        explanation: {
          type: 'string',
          maxLength: 1000,
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        cube_query: {
          type: ['object', 'null'],
          additionalProperties: true,
        },
        sql_fallback: {
          type: ['string', 'null'],
        },
        clarification_question: {
          type: ['string', 'null'],
          maxLength: 1000,
        },
      },
      required: ['mode', 'explanation', 'confidence', 'cube_query', 'sql_fallback', 'clarification_question'],
    },
  };
}

function getCubeMembersFromQuery(query, key) {
  if (!query || typeof query !== 'object') return [];
  const candidate = query[key];
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((value) => typeof value === 'string');
}

function extractFilterMembers(filters) {
  if (!Array.isArray(filters)) return [];
  const members = [];
  const stack = [...filters];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== 'object') continue;
    if (typeof item.member === 'string') members.push(item.member);
    if (Array.isArray(item.or)) stack.push(...item.or);
    if (Array.isArray(item.and)) stack.push(...item.and);
  }
  return members;
}

function extractTablesFromSql(sql) {
  const tableNames = [];
  const tableRegex = /\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi;
  let match = tableRegex.exec(sql);
  while (match) {
    tableNames.push(match[1]);
    match = tableRegex.exec(sql);
  }
  return tableNames;
}

function extractQualifiedMembersFromSql(sql) {
  const members = [];
  const memberRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let match = memberRegex.exec(sql);
  while (match) {
    members.push({
      table: match[1],
      column: match[2],
    });
    match = memberRegex.exec(sql);
  }
  return members;
}

function extractOrderMembers(order) {
  if (!order) return [];

  if (!Array.isArray(order) && typeof order === 'object') {
    return Object.keys(order).filter((key) => typeof key === 'string' && key.trim() !== '');
  }

  if (!Array.isArray(order)) return [];

  const members = [];
  for (const item of order) {
    if (Array.isArray(item) && typeof item[0] === 'string') {
      members.push(item[0]);
      continue;
    }

    if (!item || typeof item !== 'object') continue;
    if (typeof item.member === 'string') {
      members.push(item.member);
      continue;
    }
    if (typeof item.measure === 'string') {
      members.push(item.measure);
      continue;
    }
    if (typeof item.dimension === 'string') {
      members.push(item.dimension);
      continue;
    }
  }

  return members;
}

function normalizeCubeQueryForLoad(cubeQuery) {
  if (!cubeQuery || typeof cubeQuery !== 'object' || Array.isArray(cubeQuery)) {
    return null;
  }

  const record = cubeQuery;
  if (record.query && typeof record.query === 'object' && !Array.isArray(record.query)) {
    return record.query;
  }

  if (Array.isArray(record.queries)) {
    const firstQuery = record.queries.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    return firstQuery || null;
  }

  return record;
}

export class SeFiAgentService {
  constructor({ config, database, fetchImpl = fetch }) {
    this.config = config;
    this.database = database;
    this.fetchImpl = fetchImpl;
  }

  cubeHeaders(contentType = null) {
    const headers = {
      Accept: 'application/json',
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const cubeAuth = resolveCubeAuthToken(this.config.cubeApiToken);
    if (cubeAuth.token) {
      headers.Authorization = `Bearer ${cubeAuth.token}`;
      headers['x-cubejs-api-token'] = cubeAuth.token;
    }

    return headers;
  }

  async fetchCubeMeta() {
    const response = await this.fetchImpl(`${this.config.cubeApiUrl}/meta`, {
      method: 'GET',
      headers: this.cubeHeaders(),
    });

    if (!response.ok) {
      throw createAgentError(`Cube metadata request failed with HTTP ${response.status}`, 502, 'CUBE_META_FAILED');
    }

    const payload = await response.json();
    const cubes = Array.isArray(payload?.cubes) ? payload.cubes : [];

    return cubes.map((cube) => ({
      name: cube.name,
      title: cube.title || null,
      measures: Array.isArray(cube.measures)
        ? cube.measures.map((measure) => ({
            name: measure.name,
            title: measure.title || null,
            type: measure.type || null,
          }))
        : [],
      dimensions: Array.isArray(cube.dimensions)
        ? cube.dimensions.map((dimension) => ({
            name: dimension.name,
            title: dimension.title || null,
            type: dimension.type || null,
          }))
        : [],
    }));
  }

  buildSqliteFallbackContext(reason) {
    const schema = Array.isArray(this.database.getSqliteSchema?.()) ? this.database.getSqliteSchema() : [];
    const cubes = schema.map((table) => ({
      name: String(table.name || ''),
      title: String(table.name || ''),
      measures: [
        {
          name: `${String(table.name || '')}.row_count`,
          title: 'Row Count',
          type: 'number',
        },
      ],
      dimensions: Array.isArray(table.columns)
        ? table.columns.map((column) => ({
            name: `${String(table.name || '')}.${String(column.name || '')}`,
            title: String(column.name || ''),
            type: String(column.type || 'string').toLowerCase() || 'string',
          }))
        : [],
    }));

    const measures = cubes.flatMap((cube) => cube.measures.map((measure) => measure.name));
    const dimensions = cubes.flatMap((cube) => cube.dimensions.map((dimension) => dimension.name));

    return {
      generated_at: new Date().toISOString(),
      metadata_source: 'sqlite_fallback',
      metadata_warning: reason,
      cube_count: cubes.length,
      measure_count: measures.length,
      dimension_count: dimensions.length,
      cubes,
      allowlist: {
        measures,
        dimensions,
      },
    };
  }

  async getSemanticContext() {
    let cubes = [];
    try {
      cubes = await this.fetchCubeMeta();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Cube metadata unavailable';
      return this.buildSqliteFallbackContext(reason);
    }

    const measures = cubes.flatMap((cube) => cube.measures.map((measure) => measure.name));
    const dimensions = cubes.flatMap((cube) => cube.dimensions.map((dimension) => dimension.name));

    return {
      generated_at: new Date().toISOString(),
      metadata_source: 'cube',
      metadata_warning: null,
      cube_count: cubes.length,
      measure_count: measures.length,
      dimension_count: dimensions.length,
      cubes,
      allowlist: {
        measures,
        dimensions,
      },
    };
  }

  async getPlaygroundContext() {
    const context = await this.getSemanticContext();
    return {
      ...context,
      defaults: {
        auto_execute: this.config.agentAutoExecuteDefault,
        allow_sql_fallback: this.config.agentSqlFallbackDefault,
      },
    };
  }

  buildPromptContext(context) {
    return {
      cubes: context.cubes.map((cube) => ({
        name: cube.name,
        title: cube.title,
        measures: cube.measures.map((measure) => ({ name: measure.name, title: measure.title, type: measure.type })),
        dimensions: cube.dimensions.map((dimension) => ({ name: dimension.name, title: dimension.title, type: dimension.type })),
      })),
      constraints: {
        semantic_first: true,
        metadata_only: true,
        read_only_sql_only: true,
      },
    };
  }

  normalizeOptions(options = {}) {
    const strongModel = normalizeBoolean(options.strong_model, false);
    const autoExecute = normalizeBoolean(options.auto_execute, this.config.agentAutoExecuteDefault);
    const allowSqlFallback = normalizeBoolean(options.allow_sql_fallback, this.config.agentSqlFallbackDefault);
    const maxRows = normalizePositiveInt(options.max_rows, 200, 1, 2000);

    return {
      strongModel,
      autoExecute,
      allowSqlFallback,
      maxRows,
    };
  }

  validateCubeQuery(cubeQuery, context) {
    const normalizedCubeQuery = normalizeCubeQueryForLoad(cubeQuery);
    if (!normalizedCubeQuery) {
      return ['cube_query payload is required when mode is cube_query'];
    }

    const allowedMembers = new Set([
      ...context.allowlist.measures.map((value) => value.toLowerCase()),
      ...context.allowlist.dimensions.map((value) => value.toLowerCase()),
    ]);

    const usedMembers = [
      ...getCubeMembersFromQuery(normalizedCubeQuery, 'measures'),
      ...getCubeMembersFromQuery(normalizedCubeQuery, 'dimensions'),
      ...getCubeMembersFromQuery(normalizedCubeQuery, 'segments'),
      ...extractFilterMembers(normalizedCubeQuery.filters),
      ...(Array.isArray(normalizedCubeQuery.timeDimensions)
        ? normalizedCubeQuery.timeDimensions
            .filter((item) => item && typeof item === 'object' && typeof item.dimension === 'string')
            .map((item) => item.dimension)
        : []),
      ...extractOrderMembers(normalizedCubeQuery.order),
    ];

    const errors = [];
    for (const member of usedMembers) {
      if (!allowedMembers.has(String(member).toLowerCase())) {
        errors.push(`Unknown semantic member: ${member}`);
      }
    }
    return errors;
  }

  validateSqlFallback(sql) {
    const text = String(sql || '').trim();
    if (!text) {
      return ['sql_fallback is required when mode is sql_fallback'];
    }

    const schema = this.database.getSqliteSchema();
    const tableMap = new Map();
    for (const table of schema) {
      tableMap.set(String(table.name).toLowerCase(), new Set(table.columns.map((column) => String(column.name).toLowerCase())));
    }

    const errors = [];
    const usedTables = extractTablesFromSql(text);
    for (const table of usedTables) {
      if (!tableMap.has(String(table).toLowerCase())) {
        errors.push(`Unknown table in SQL fallback: ${table}`);
      }
    }

    const qualifiedMembers = extractQualifiedMembersFromSql(text);
    for (const member of qualifiedMembers) {
      const table = tableMap.get(member.table.toLowerCase());
      if (!table) {
        errors.push(`Unknown table qualifier in SQL fallback: ${member.table}`);
        continue;
      }
      if (!table.has(member.column.toLowerCase())) {
        errors.push(`Unknown column in SQL fallback: ${member.table}.${member.column}`);
      }
    }

    return errors;
  }

  validatePlan(plan, context, options) {
    const errors = [];
    const warnings = [];

    if (!plan || typeof plan !== 'object') {
      return {
        valid: false,
        errors: ['Agent output is not a JSON object'],
        warnings,
      };
    }

    const mode = String(plan.mode || '').trim();
    if (!['cube_query', 'clarification', 'sql_fallback'].includes(mode)) {
      errors.push(`Unsupported mode: ${mode || 'empty'}`);
    }

    if (mode === 'cube_query') {
      errors.push(...this.validateCubeQuery(plan.cube_query, context));
    }

    if (mode === 'sql_fallback') {
      if (!options.allowSqlFallback) {
        errors.push('SQL fallback is disabled by policy');
      } else {
        errors.push(...this.validateSqlFallback(plan.sql_fallback));
      }
    }

    if (mode === 'clarification' && !plan.clarification_question) {
      warnings.push('Clarification mode is missing clarification_question');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  createSystemPrompt(options, context) {
    const metadataSource = String(context?.metadata_source || 'cube');
    return [
      'You are SeFi semantic query planner.',
      'Always prefer semantic Cube query generation when possible.',
      'Use only members that exist in provided metadata context.',
      'If user intent is ambiguous, use clarification mode.',
      `Semantic context source: ${metadataSource}.`,
      metadataSource !== 'cube'
        ? 'Cube metadata is degraded; prefer sql_fallback plans over cube_query.'
        : '',
      `SQL fallback allowed: ${options.allowSqlFallback ? 'yes' : 'no'}.`,
      'Never output markdown. Output strict JSON matching schema only.',
      'When generating SQL fallback, keep it read-only SELECT/WITH/EXPLAIN and include LIMIT when meaningful.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async callOpenAI(question, context, options) {
    if (!this.config.openaiApiKey) {
      throw createAgentError('OPENAI_API_KEY is not configured', 503, 'OPENAI_NOT_CONFIGURED');
    }

    const model = options.strongModel ? this.config.openaiModelStrong : this.config.openaiModelFast;
    const responseFormat = createResponseSchema();
    const promptContext = this.buildPromptContext(context);

    const response = await this.fetchImpl(`${this.config.openaiApiBaseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: this.createSystemPrompt(options, context),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  question,
                  context: promptContext,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: responseFormat.name,
            strict: responseFormat.strict,
            schema: responseFormat.schema,
          },
        },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI request failed with HTTP ${response.status}`;
      throw createAgentError(message, 502, 'OPENAI_REQUEST_FAILED', payload?.error || null);
    }

    const outputText = pickOutputText(payload);
    if (!outputText) {
      throw createAgentError('OpenAI response did not include structured output text', 502, 'OPENAI_EMPTY_OUTPUT');
    }

    const parsed = parseJsonSafe(outputText);
    if (!parsed) {
      throw createAgentError('OpenAI returned invalid JSON for agent plan', 502, 'OPENAI_INVALID_JSON', { outputText });
    }

    return {
      model,
      parsed,
      raw_output: outputText,
    };
  }

  normalizePlan(plan) {
    return {
      mode: String(plan.mode || '').trim(),
      explanation: String(plan.explanation || '').trim(),
      confidence: Number.isFinite(plan.confidence) ? Number(plan.confidence) : 0,
      cube_query: plan.cube_query && typeof plan.cube_query === 'object' ? plan.cube_query : null,
      sql_fallback: typeof plan.sql_fallback === 'string' ? plan.sql_fallback : null,
      clarification_question: typeof plan.clarification_question === 'string' ? plan.clarification_question : null,
    };
  }

  async generatePlan(question, requestOptions = {}) {
    const normalizedQuestion = String(question || '').trim();
    if (!normalizedQuestion) {
      throw createAgentError('question is required', 400, 'INVALID_QUESTION');
    }
    if (normalizedQuestion.length > this.config.agentMaxQuestionChars) {
      throw createAgentError(
        `question is too long (max ${this.config.agentMaxQuestionChars} characters)`,
        400,
        'INVALID_QUESTION'
      );
    }

    const options = this.normalizeOptions(requestOptions);
    const context = await this.getSemanticContext();
    const llm = await this.callOpenAI(normalizedQuestion, context, options);
    const plan = this.normalizePlan(llm.parsed);
    const validation = this.validatePlan(plan, context, options);

    return {
      request_id: crypto.randomUUID(),
      question: normalizedQuestion,
      options,
      context_summary: {
        metadata_source: String(context.metadata_source || 'cube'),
        metadata_warning: context.metadata_warning || null,
        cube_count: context.cube_count,
        measure_count: context.measure_count,
        dimension_count: context.dimension_count,
      },
      plan,
      validation,
      llm: {
        model: llm.model,
      },
    };
  }

  async executePlan(planInput, requestOptions = {}) {
    const options = this.normalizeOptions(requestOptions);
    const context = await this.getSemanticContext();
    const plan = this.normalizePlan(planInput);
    const validation = this.validatePlan(plan, context, options);

    if (!validation.valid) {
      throw createAgentError('Plan validation failed', 400, 'PLAN_VALIDATION_FAILED', { errors: validation.errors });
    }

    if (plan.mode === 'clarification') {
      return {
        executed: false,
        mode: 'clarification',
        clarification_question: plan.clarification_question,
      };
    }

    if (plan.mode === 'cube_query') {
      const normalizedCubeQuery = normalizeCubeQueryForLoad(plan.cube_query);
      if (!normalizedCubeQuery) {
        throw createAgentError('cube_query payload is required when mode is cube_query', 400, 'PLAN_VALIDATION_FAILED');
      }

      if (context.metadata_source !== 'cube') {
        throw createAgentError(
          'Cube metadata unavailable; execute SQL fallback or restore Cube access',
          503,
          'CUBE_METADATA_UNAVAILABLE',
          {
            metadata_source: context.metadata_source,
            metadata_warning: context.metadata_warning || null,
          }
        );
      }

      const response = await this.fetchImpl(`${this.config.cubeApiUrl}/load`, {
        method: 'POST',
        headers: this.cubeHeaders('application/json'),
        body: JSON.stringify({ query: normalizedCubeQuery }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw createAgentError(
          payload?.error || `Cube query execution failed with HTTP ${response.status}`,
          502,
          'CUBE_EXECUTION_FAILED',
          payload
        );
      }
      return {
        executed: true,
        mode: 'cube_query',
        result: payload,
      };
    }

    const sqlResult = this.database.executeReadOnlyQuery(plan.sql_fallback, { maxRows: options.maxRows });
    return {
      executed: true,
      mode: 'sql_fallback',
      result: sqlResult,
    };
  }

  async ask(question, requestOptions = {}) {
    const planResult = await this.generatePlan(question, requestOptions);
    const cubeExecutionAllowed = planResult.context_summary.metadata_source === 'cube';
    const shouldExecute =
      planResult.options.autoExecute &&
      planResult.validation.valid &&
      (
        planResult.plan.mode === 'sql_fallback' ||
        (planResult.plan.mode === 'cube_query' && cubeExecutionAllowed)
      );

    if (!shouldExecute) {
      return {
        ...planResult,
        executed: false,
      };
    }

    const execution = await this.executePlan(planResult.plan, planResult.options);
    return {
      ...planResult,
      executed: true,
      execution,
    };
  }
}
