import crypto from 'crypto';

function createOrchestratorError(message, status = 400, code = 'AGENT_ORCHESTRATOR_ERROR', details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function normalizeObject(value, fallback = {}) {
  if (!isPlainObject(value)) return fallback;
  return value;
}

function uniqueStrings(values) {
  const normalized = values
    .map((item) => normalizeString(item))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function sanitizeLabel(value) {
  return normalizeString(value).slice(0, 120);
}

function normalizeMirrorPublicKeyHex(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  // Mirror nodes may return DER-prefixed Ed25519 keys; strip to raw key bytes.
  return normalized.replace(/^302a300506032b6570032100/, '');
}

function inferMirrorKeyType(publicKeyHex) {
  if (/^(02|03)[0-9a-f]{64}$/i.test(publicKeyHex)) return 'ecdsa';
  if (/^[0-9a-f]{64}$/i.test(publicKeyHex)) return 'ed25519';
  return 'unknown';
}

function nowIso() {
  return new Date().toISOString();
}

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

const DEFAULT_BRAINSTORM_TEMPLATES = [
  {
    key: 'market_pulse',
    label: 'Market Pulse',
    description: 'Recurring overview of protocol activity and movement.',
    prompt_suffix: 'Generate concise market pulse posts with concrete metrics and trend context.',
  },
  {
    key: 'risk_watch',
    label: 'Risk Watch',
    description: 'Flag unusual volume, transfer spikes, and operational anomalies.',
    prompt_suffix: 'Prioritize safety signals, anomaly explanation, and operator-ready alerts.',
  },
  {
    key: 'bonzo_clmm_guard',
    label: 'Bonzo CLMM Guard',
    description: 'Monitor volatility and recommend CLMM range actions before major dislocations.',
    prompt_suffix:
      'Classify volatility regime and provide explicit CLMM range actions: tighten, widen, or single-sided safety mode.',
  },
  {
    key: 'protocol_narrator',
    label: 'Protocol Narrator',
    description: 'Turn raw activity into plain-language protocol storytelling.',
    prompt_suffix: 'Explain protocol movement like a domain analyst without losing metric precision.',
  },
  {
    key: 'ops_reporter',
    label: 'Ops Reporter',
    description: 'Operational updates focused on health and indexing outcomes.',
    prompt_suffix: 'Track system health, indexing progress, and actionable runbook notes.',
  },
  {
    key: 'topic_mirror',
    label: 'Topic Mirror',
    description: 'Create semantic summaries and mirror them into Hedera topics.',
    prompt_suffix: 'Always produce structured semantic summaries ready for HCS publication.',
  },
  {
    key: 'social_analyst',
    label: 'Social Analyst',
    description: 'Blend semantic metrics with social-friendly voice for X posts.',
    prompt_suffix: 'Write platform-native posts with concise hooks and metric-backed claims.',
  },
];

function defaultSemanticScope() {
  return {
    allowed_cubes: [],
    allowed_members: [],
    time_window: '7d',
    max_rows: 200,
  };
}

function defaultSchedule() {
  return {
    enabled: false,
    cadence: 'manual',
    interval_minutes: 60,
    timezone: 'UTC',
    cron: '',
    action: 'publish_test',
    question: 'Generate a semantic summary for recent protocol activity.',
    summary: 'Scheduled protocol summary update.',
    voice_text: 'Keep this concise and operator-friendly.',
  };
}

function defaultPublishTargets(type) {
  return {
    hcs: {
      enabled: true,
      topic_id: null,
      create_if_missing: true,
    },
    twitter: {
      enabled: type === 'elizaos',
      mode: 'semantic_plus_voice',
    },
  };
}

function defaultTools(type) {
  const base = ['sefi.semantic.context', 'sefi.semantic.query', 'sefi.semantic.summarize', 'hedera.hcs.publish'];
  if (type === 'hedera') {
    return [...base, 'hedera.hcs.create', 'hedera.network.read'];
  }
  return [...base, '@elizaos/plugin-bootstrap', '@elizaos/plugin-hedera', 'plugin-sefi-semantic'];
}

function normalizeEnvRefs(value) {
  const refs = normalizeArray(value);
  const normalized = [];
  for (const item of refs) {
    if (!isPlainObject(item)) continue;
    const key = normalizeString(item.key).toLowerCase();
    const envVarName = normalizeString(item.env_var_name || item.envVarName || item.name);
    if (!key || !envVarName) continue;
    if (!ENV_VAR_PATTERN.test(envVarName)) {
      throw createOrchestratorError(`Invalid env var name for "${key}"`, 400, 'INVALID_ENV_REF');
    }
    normalized.push({
      key,
      env_var_name: envVarName,
      required: normalizeBoolean(item.required, true),
      description: normalizeString(item.description || ''),
    });
  }
  return normalized;
}

function buildDefaultEnvRefs(type) {
  if (type === 'hedera') {
    return [
      { key: 'hedera_account_id', env_var_name: 'SEFI_HEDERA_ACCOUNT_ID', required: true },
      { key: 'hedera_private_key', env_var_name: 'SEFI_HEDERA_PRIVATE_KEY', required: true },
    ];
  }

  return [
    { key: 'eliza_openai_api_key', env_var_name: 'OPENAI_API_KEY', required: true },
    { key: 'twitter_api_key', env_var_name: 'SEFI_TWITTER_API_KEY', required: false },
    { key: 'twitter_api_secret', env_var_name: 'SEFI_TWITTER_API_SECRET', required: false },
    { key: 'twitter_access_token', env_var_name: 'SEFI_TWITTER_ACCESS_TOKEN', required: false },
    { key: 'twitter_access_secret', env_var_name: 'SEFI_TWITTER_ACCESS_SECRET', required: false },
  ];
}

function parseQuestion(value) {
  const question = normalizeString(value);
  if (!question) return null;
  return question.slice(0, 2000);
}

export class AgentOrchestrator {
  constructor({ config, database, indexer, agentService, fetchImpl = fetch, logger = console }) {
    this.config = config;
    this.database = database;
    this.indexer = indexer;
    this.agentService = agentService;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  listBrainstormTemplates() {
    return DEFAULT_BRAINSTORM_TEMPLATES;
  }

  listAgents() {
    return this.database.listAgents();
  }

  getAgent(agentId) {
    const agent = this.database.getAgentById(agentId);
    if (!agent) {
      throw createOrchestratorError(`Agent not found: ${agentId}`, 404, 'NOT_FOUND');
    }
    return agent;
  }

  buildBonzoClmmGuardSeed() {
    const preferredNetwork = this.getAllowedAutonomousNetworks().includes(
      normalizeString(this.config.network || '').toLowerCase()
    )
      ? normalizeString(this.config.network || 'testnet').toLowerCase()
      : this.getAllowedAutonomousNetworks()[0];

    return {
      id: 'bonzo-clmm-volatility-guard',
      name: 'Bonzo CLMM Volatility Guard',
      type: 'hedera',
      network: preferredNetwork,
      model_provider: 'openai',
      model_name: normalizeString(this.config.openaiModelFast || 'gpt-5-mini'),
      system_prompt: [
        'You monitor Bonzo concentrated liquidity vault risk.',
        'Compute realized volatility regime from indexed market activity.',
        'Low volatility: recommend tighter liquidity ranges for fee capture.',
        'High volatility: recommend preemptive wider ranges or single-sided safety mode.',
        'Always include numeric thresholds and confidence.',
      ].join('\n'),
      topics: ['bonzo', 'clmm', 'volatility', 'risk watch'],
      semantic_scope: {
        allowed_cubes: [],
        allowed_members: [],
        time_window: 'all',
        max_rows: 2000,
      },
      tool_allowlist: defaultTools('hedera'),
      publish_targets: {
        hcs: {
          enabled: true,
          topic_id: null,
          create_if_missing: true,
        },
        twitter: {
          enabled: false,
        },
      },
      schedule: {
        enabled: true,
        cadence: 'interval',
        interval_minutes: 10,
        timezone: 'UTC',
        cron: '*/10 * * * *',
        action: 'bonzo_clmm_guard',
        window_minutes: 60,
        baseline_windows: 6,
        high_threshold: 2.2,
        low_threshold: 0.8,
      },
      env_refs: buildDefaultEnvRefs('hedera'),
    };
  }

  ensureBonzoClmmGuardAgent() {
    const existing = this.database.getAgentById('bonzo-clmm-volatility-guard');
    if (existing) {
      return {
        created: false,
        agent: existing,
      };
    }

    const created = this.createAgent(this.buildBonzoClmmGuardSeed());
    this.database.createAgentEvent({
      agent_id: created.id,
      run_id: null,
      event_type: 'agent_bootstrap',
      level: 'info',
      message: 'Bootstrapped Bonzo CLMM guard agent',
      payload: {
        cadence: created.schedule?.cadence || 'interval',
        interval_minutes: created.schedule?.interval_minutes || 10,
      },
    });
    return {
      created: true,
      agent: created,
    };
  }

  normalizeCreateInput(input = {}) {
    const payload = normalizeObject(input);
    const type = normalizeString(payload.type || 'hedera').toLowerCase();
    if (!['hedera', 'elizaos'].includes(type)) {
      throw createOrchestratorError('type must be one of: hedera, elizaos', 400, 'INVALID_AGENT_TYPE');
    }

    const name = normalizeString(payload.name || `${type === 'hedera' ? 'Hedera' : 'ElizaOS'} Agent`);
    if (!name) {
      throw createOrchestratorError('name is required', 400, 'INVALID_AGENT_NAME');
    }

    const network = normalizeString(payload.network || this.config.network || 'testnet').toLowerCase();
    const modelProvider = normalizeString(payload.model_provider || 'openai').toLowerCase();
    const modelName = normalizeString(payload.model_name || this.config.openaiModelFast || 'gpt-5-mini');
    const systemPrompt = normalizeString(payload.system_prompt || '');
    const topics = uniqueStrings(normalizeArray(payload.topics));
    const postExamples = uniqueStrings(normalizeArray(payload.post_examples));
    const semanticScope = {
      ...defaultSemanticScope(),
      ...normalizeObject(payload.semantic_scope),
    };
    const toolAllowlist = uniqueStrings(
      normalizeArray(payload.tool_allowlist).length > 0
        ? normalizeArray(payload.tool_allowlist)
        : defaultTools(type)
    );
    const publishTargets = {
      ...defaultPublishTargets(type),
      ...normalizeObject(payload.publish_targets),
    };
    const schedule = {
      ...defaultSchedule(),
      ...normalizeObject(payload.schedule),
    };
    const envRefs = normalizeEnvRefs(
      normalizeArray(payload.env_refs).length > 0 ? payload.env_refs : buildDefaultEnvRefs(type)
    );

    return {
      id: normalizeString(payload.id || crypto.randomUUID()),
      name,
      type,
      network,
      model_provider: modelProvider,
      model_name: modelName,
      system_prompt: systemPrompt,
      topics,
      post_examples: postExamples,
      semantic_scope: semanticScope,
      tool_allowlist: toolAllowlist,
      publish_targets: publishTargets,
      schedule,
      env_refs: envRefs,
      runtime_status: 'stopped',
      last_run_summary: null,
    };
  }

  normalizePatchInput(input = {}) {
    const payload = normalizeObject(input);
    const patch = {};

    if (payload.name !== undefined) {
      const name = normalizeString(payload.name);
      if (!name) throw createOrchestratorError('name cannot be empty', 400, 'INVALID_AGENT_NAME');
      patch.name = name;
    }

    if (payload.network !== undefined) patch.network = normalizeString(payload.network).toLowerCase();
    if (payload.model_provider !== undefined) patch.model_provider = normalizeString(payload.model_provider).toLowerCase();
    if (payload.model_name !== undefined) patch.model_name = normalizeString(payload.model_name);
    if (payload.system_prompt !== undefined) patch.system_prompt = normalizeString(payload.system_prompt);
    if (payload.topics !== undefined) patch.topics = uniqueStrings(normalizeArray(payload.topics));
    if (payload.post_examples !== undefined) patch.post_examples = uniqueStrings(normalizeArray(payload.post_examples));
    if (payload.semantic_scope !== undefined) patch.semantic_scope = normalizeObject(payload.semantic_scope, defaultSemanticScope());
    if (payload.tool_allowlist !== undefined) patch.tool_allowlist = uniqueStrings(normalizeArray(payload.tool_allowlist));
    if (payload.publish_targets !== undefined) patch.publish_targets = normalizeObject(payload.publish_targets);
    if (payload.schedule !== undefined) patch.schedule = normalizeObject(payload.schedule);
    if (payload.env_refs !== undefined) patch.env_refs = normalizeEnvRefs(payload.env_refs);

    return patch;
  }

  createAgent(input = {}) {
    const payload = this.normalizeCreateInput(input);
    const existing = this.database.getAgentById(payload.id);
    if (existing) {
      throw createOrchestratorError(`Agent id already exists: ${payload.id}`, 409, 'AGENT_EXISTS');
    }
    const created = this.database.createAgent(payload);
    this.database.createAgentEvent({
      agent_id: created.id,
      run_id: null,
      event_type: 'agent_created',
      level: 'info',
      message: `Created ${created.type} agent`,
      payload: {
        network: created.network,
        model_provider: created.model_provider,
        model_name: created.model_name,
      },
    });
    return created;
  }

  updateAgent(agentId, patchInput = {}) {
    this.getAgent(agentId);
    const patch = this.normalizePatchInput(patchInput);
    const updated = this.database.updateAgent(agentId, patch);
    this.database.createAgentEvent({
      agent_id: agentId,
      run_id: null,
      event_type: 'agent_updated',
      level: 'info',
      message: 'Agent settings updated',
      payload: {
        changed_keys: Object.keys(patch),
      },
    });
    return updated;
  }

  deleteAgent(agentId) {
    this.getAgent(agentId);
    this.database.deleteAgent(agentId);
    return { deleted: true, id: agentId };
  }

  getAgentRuns(agentId, limit = 50) {
    this.getAgent(agentId);
    return this.database.getAgentRuns(agentId, limit);
  }

  getAgentActivity(agentId, limit = 100) {
    this.getAgent(agentId);
    return this.database.getAgentEvents(agentId, limit);
  }

  listTopicRegistrations() {
    return this.database.getAllAgentTopicRegistrations();
  }

  resolveEnvMap(agent) {
    const refs = normalizeArray(agent.env_refs);
    const envMap = {};
    const missing = [];
    for (const ref of refs) {
      const key = normalizeString(ref.key).toLowerCase();
      const envName = normalizeString(ref.env_var_name);
      if (!key || !envName) continue;
      const value = process.env[envName];
      if ((value === undefined || value === '') && normalizeBoolean(ref.required, true)) {
        missing.push({
          key,
          env_var_name: envName,
        });
        continue;
      }
      envMap[key] = value || '';
    }
    return { envMap, missing };
  }

  getAllowedAutonomousNetworks() {
    const configured = Array.isArray(this.config.agentAutonomousNetworks)
      ? this.config.agentAutonomousNetworks
      : ['testnet'];
    const normalized = configured
      .map((network) => normalizeString(network).toLowerCase())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : ['testnet'];
  }

  assertAutonomousPolicy(agent) {
    const network = normalizeString(agent.network || '').toLowerCase();
    const allowedNetworks = this.getAllowedAutonomousNetworks();
    if (!allowedNetworks.includes(network)) {
      throw createOrchestratorError(
        `Autonomous Hedera execution is blocked for network "${network}"`,
        400,
        'AUTONOMOUS_NETWORK_BLOCKED',
        { network, allowed_networks: allowedNetworks }
      );
    }
  }

  async startAgent(agentId) {
    const agent = this.getAgent(agentId);
    const runId = crypto.randomUUID();
    this.database.createAgentRun({
      id: runId,
      agent_id: agent.id,
      status: 'running',
      mode: 'manual',
      trigger_source: 'start',
      summary: 'Starting agent runtime',
      details: null,
      started_at: nowIso(),
      finished_at: null,
    });

    try {
      const envResolution = this.resolveEnvMap(agent);
      if (envResolution.missing.length > 0) {
        throw createOrchestratorError(
          'Missing required env references for agent runtime',
          400,
          'MISSING_ENV_REFS',
          { missing: envResolution.missing }
        );
      }

      if (agent.type === 'hedera') {
        this.assertAutonomousPolicy(agent);
        this.database.createAgentEvent({
          agent_id: agent.id,
          run_id: runId,
          event_type: 'hedera_runtime_start',
          level: 'info',
          message: 'Hedera agent runtime enabled',
          payload: { network: agent.network },
        });
      } else if (agent.type === 'elizaos') {
        const syncResult = await this.syncElizaAgent(agent);
        this.database.createAgentEvent({
          agent_id: agent.id,
          run_id: runId,
          event_type: 'eliza_runtime_sync',
          level: syncResult.ok ? 'info' : 'warning',
          message: syncResult.ok ? 'Eliza agent synchronized' : 'Eliza sidecar sync degraded',
          payload: syncResult,
        });
      }

      const updated = this.database.setAgentRuntimeStatus(agent.id, 'running', {
        status: 'success',
        message: 'Agent started',
        started_at: nowIso(),
      });
      this.database.finishAgentRun(runId, {
        status: 'success',
        summary: 'Agent runtime started',
        details: { runtime_status: updated.runtime_status },
        finished_at: nowIso(),
      });
      return updated;
    } catch (error) {
      this.database.setAgentRuntimeStatus(agent.id, 'degraded', {
        status: 'error',
        message: error.message,
      });
      this.database.finishAgentRun(runId, {
        status: 'error',
        summary: error.message,
        details: error.details || null,
        finished_at: nowIso(),
      });
      this.database.createAgentEvent({
        agent_id: agent.id,
        run_id: runId,
        event_type: 'runtime_start_failed',
        level: 'error',
        message: error.message,
        payload: error.details || null,
      });
      throw error;
    }
  }

  async stopAgent(agentId) {
    const agent = this.getAgent(agentId);
    const runId = crypto.randomUUID();
    this.database.createAgentRun({
      id: runId,
      agent_id: agent.id,
      status: 'running',
      mode: 'manual',
      trigger_source: 'stop',
      summary: 'Stopping agent runtime',
      details: null,
      started_at: nowIso(),
      finished_at: null,
    });

    if (agent.type === 'elizaos') {
      const stopResult = await this.stopElizaAgent(agent).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      this.database.createAgentEvent({
        agent_id: agent.id,
        run_id: runId,
        event_type: 'eliza_runtime_stop',
        level: stopResult.ok ? 'info' : 'warning',
        message: stopResult.ok ? 'Eliza runtime stopped' : 'Eliza runtime stop degraded',
        payload: stopResult,
      });
    }

    const updated = this.database.setAgentRuntimeStatus(agent.id, 'stopped', {
      status: 'success',
      message: 'Agent stopped',
      stopped_at: nowIso(),
    });
    this.database.finishAgentRun(runId, {
      status: 'success',
      summary: 'Agent runtime stopped',
      details: { runtime_status: updated.runtime_status },
      finished_at: nowIso(),
    });
    return updated;
  }

  async applyBrainstorm(agentId, payload = {}) {
    const agent = this.getAgent(agentId);
    const templateKey = normalizeString(payload.template_key || payload.template).toLowerCase();
    const template = DEFAULT_BRAINSTORM_TEMPLATES.find((item) => item.key === templateKey) || DEFAULT_BRAINSTORM_TEMPLATES[0];

    const idea = normalizeString(payload.idea || 'Build actionable intelligence from the semantic layer');
    const audience = normalizeString(payload.audience || 'Protocol operators and ecosystem analysts');
    const tone = normalizeString(payload.tone || 'Concise, confident, and evidence-backed');
    const requiredMetrics = uniqueStrings(normalizeArray(payload.required_metrics || payload.metrics));
    const outputChannel = normalizeString(payload.output_channel || (agent.type === 'elizaos' ? 'hcs + twitter' : 'hcs'));
    const sampleDrafts = uniqueStrings(normalizeArray(payload.sample_drafts || payload.samples));

    const systemPrompt = [
      `Agent mission: ${idea}`,
      `Audience: ${audience}`,
      `Tone: ${tone}`,
      `Output channel: ${outputChannel}`,
      requiredMetrics.length > 0 ? `Required metrics: ${requiredMetrics.join(', ')}` : '',
      template.prompt_suffix,
      'Every claim must be backed by semantic data or clearly marked as commentary.',
    ]
      .filter(Boolean)
      .join('\n');

    const patch = {
      system_prompt: systemPrompt,
      topics: uniqueStrings([template.label, ...agent.topics, ...requiredMetrics]),
      post_examples: uniqueStrings([...agent.post_examples, ...sampleDrafts]),
    };

    const updated = this.database.updateAgent(agent.id, patch);
    this.database.createAgentEvent({
      agent_id: agent.id,
      run_id: null,
      event_type: 'brainstorm_updated',
      level: 'info',
      message: `Brainstorm updated using template "${template.label}"`,
      payload: {
        template_key: template.key,
        audience,
        tone,
        output_channel: outputChannel,
      },
    });

    return {
      template,
      agent: updated,
      brainstorm: {
        idea,
        audience,
        tone,
        required_metrics: requiredMetrics,
        output_channel: outputChannel,
      },
    };
  }

  buildStructuredSemanticPayload(agent, data = {}) {
    const overview = this.database.getOverview();
    const timeRange = normalizeString(data.time_range || 'last_24h');
    const summary = normalizeString(data.summary || `Records indexed: ${overview.records_indexed}`);
    const sourceQuery = normalizeString(data.source_query || data.question || 'SeFi semantic aggregate');
    const payload = {
      agent_id: agent.id,
      agent_type: agent.type,
      created_at: nowIso(),
      source_query: sourceQuery,
      time_range: timeRange,
      metric_snapshot: {
        records_indexed: overview.records_indexed,
        total_contract_logs: overview.database.total_contract_logs,
        total_hts_transfers: overview.database.total_hts_transfers,
        total_erc20_transfers: overview.database.total_erc20_transfers,
        total_topic_messages: overview.database.total_topic_messages,
      },
      summary_text: summary,
      voice_text: normalizeString(data.voice_text || ''),
    };

    if (isPlainObject(data.extra)) {
      payload.extra = data.extra;
    }

    return payload;
  }

  evaluateBonzoVolatilitySignal(agent, schedule = {}) {
    const windowMinutes = Math.max(5, Math.min(1440, Math.trunc(normalizeNumber(schedule.window_minutes, 60))));
    const baselineWindows = Math.max(2, Math.min(48, Math.trunc(normalizeNumber(schedule.baseline_windows, 6))));
    const highThreshold = Math.max(1, normalizeNumber(schedule.high_threshold, 2.2));
    const lowThreshold = Math.max(0.1, normalizeNumber(schedule.low_threshold, 0.8));

    const recentOffset = `-${windowMinutes} minutes`;
    const baselineEnd = `-${windowMinutes} minutes`;
    const baselineStart = `-${windowMinutes * (baselineWindows + 1)} minutes`;

    const recent = this.database.queryOne(
      `SELECT
         COUNT(*) AS transfer_count,
         COALESCE(SUM(ABS(CAST(amount AS REAL))), 0) AS transfer_volume
       FROM hbar_transfers
       WHERE indexed_at >= datetime('now', ?)`,
      [recentOffset]
    ) || { transfer_count: 0, transfer_volume: 0 };

    const baseline = this.database.queryOne(
      `SELECT
         COUNT(*) AS transfer_count,
         COALESCE(SUM(ABS(CAST(amount AS REAL))), 0) AS transfer_volume
       FROM hbar_transfers
       WHERE indexed_at < datetime('now', ?)
         AND indexed_at >= datetime('now', ?)`,
      [baselineEnd, baselineStart]
    ) || { transfer_count: 0, transfer_volume: 0 };

    const recentCount = normalizeNumber(recent.transfer_count, 0);
    const recentVolume = normalizeNumber(recent.transfer_volume, 0);
    const baselineCountPerWindow = normalizeNumber(baseline.transfer_count, 0) / baselineWindows;
    const baselineVolumePerWindow = normalizeNumber(baseline.transfer_volume, 0) / baselineWindows;

    const countRatio = recentCount / Math.max(1, baselineCountPerWindow);
    const volumeRatio = recentVolume / Math.max(1, baselineVolumePerWindow);
    const volatilityScore = Math.max(countRatio, volumeRatio);

    let regime = 'neutral';
    let recommendation = 'Keep current CLMM range while monitoring intraday volatility drift.';
    let action = 'hold';

    if (volatilityScore >= highThreshold) {
      regime = 'high_volatility';
      action = 'widen_or_single_side';
      recommendation =
        'High volatility detected: widen CLMM ranges preemptively or rotate to single-sided safety allocation.';
    } else if (volatilityScore <= lowThreshold) {
      regime = 'low_volatility';
      action = 'tighten_ranges';
      recommendation =
        'Low volatility regime: tighten CLMM ranges to increase fee capture efficiency.';
    }

    return {
      protocol: 'bonzo',
      strategy: 'clmm_volatility_guard',
      generated_at: nowIso(),
      window_minutes: windowMinutes,
      baseline_windows: baselineWindows,
      thresholds: {
        high: highThreshold,
        low: lowThreshold,
      },
      metrics: {
        recent_transfer_count: recentCount,
        recent_transfer_volume: recentVolume,
        baseline_transfer_count_per_window: baselineCountPerWindow,
        baseline_transfer_volume_per_window: baselineVolumePerWindow,
        count_ratio: Number(countRatio.toFixed(4)),
        volume_ratio: Number(volumeRatio.toFixed(4)),
        volatility_score: Number(volatilityScore.toFixed(4)),
      },
      regime,
      action,
      recommendation,
      network: normalizeString(agent.network || 'testnet').toLowerCase(),
    };
  }

  async runBonzoClmmGuard(agentId, options = {}) {
    const agent = this.getAgent(agentId);
    const schedule = normalizeObject(agent.schedule, {});
    const runId = crypto.randomUUID();
    const runMode = normalizeString(options.mode || 'scheduled');
    const triggerSource = normalizeString(options.trigger_source || 'schedule');

    this.database.createAgentRun({
      id: runId,
      agent_id: agent.id,
      status: 'running',
      mode: runMode,
      trigger_source: triggerSource,
      summary: 'Evaluating Bonzo CLMM volatility guard',
      details: null,
      started_at: nowIso(),
      finished_at: null,
    });

    try {
      const signal = this.evaluateBonzoVolatilitySignal(agent, schedule);
      const payload = this.buildStructuredSemanticPayload(agent, {
        source_query: 'bonzo_clmm_volatility_guard',
        time_range: `${signal.window_minutes}m`,
        summary: signal.recommendation,
        voice_text: normalizeString(schedule.voice_text || 'Operator-ready risk signal'),
        extra: {
          strategy_signal: signal,
        },
      });

      const hcsResult = await this.publishToHcs(agent, payload);
      const success = Boolean(hcsResult.ok);
      const summary = success
        ? `Bonzo guard signal published (${signal.action})`
        : `Bonzo guard signal degraded (${signal.action})`;

      const details = {
        signal,
        channels: {
          hcs: hcsResult,
        },
      };

      this.database.finishAgentRun(runId, {
        status: success ? 'success' : 'warning',
        summary,
        details,
        finished_at: nowIso(),
      });
      const updated = this.database.setAgentRuntimeStatus(agent.id, success ? 'running' : 'degraded', {
        status: success ? 'success' : 'warning',
        message: summary,
        channels: details.channels,
      });

      this.database.createAgentEvent({
        agent_id: agent.id,
        run_id: runId,
        event_type: 'bonzo_volatility_signal',
        level: success ? 'info' : 'warning',
        message: summary,
        payload: {
          signal,
          channel: hcsResult,
        },
      });

      return {
        run_id: runId,
        summary,
        success,
        agent: updated,
        signal,
        channels: details.channels,
      };
    } catch (error) {
      this.database.finishAgentRun(runId, {
        status: 'error',
        summary: error.message,
        details: error.details || null,
        finished_at: nowIso(),
      });
      this.database.setAgentRuntimeStatus(agent.id, 'degraded', {
        status: 'error',
        message: error.message,
      });
      this.database.createAgentEvent({
        agent_id: agent.id,
        run_id: runId,
        event_type: 'bonzo_volatility_signal_failed',
        level: 'error',
        message: error.message,
        payload: error.details || null,
      });
      throw error;
    }
  }

  async fetchMirrorAccountPublicKey(network, accountId) {
    const normalizedNetwork = normalizeString(network || 'testnet').toLowerCase();
    const mirrorBase =
      normalizedNetwork === 'mainnet'
        ? 'https://mainnet.mirrornode.hedera.com'
        : normalizedNetwork === 'previewnet'
          ? 'https://previewnet.mirrornode.hedera.com'
          : 'https://testnet.mirrornode.hedera.com';
    const url = `${mirrorBase}/api/v1/accounts/${encodeURIComponent(accountId)}`;
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const keyHex = normalizeMirrorPublicKeyHex(payload?.key?.key || '');
      return keyHex || null;
    } catch {
      return null;
    }
  }

  async resolveHederaOperatorKey(sdk, accountId, rawPrivateKey, network) {
    const privateKeyInput = normalizeString(rawPrivateKey);
    const mirrorPublicKeyHex = await this.fetchMirrorAccountPublicKey(network, accountId);
    const mirrorKeyType = inferMirrorKeyType(mirrorPublicKeyHex || '');

    const parseFns = {
      auto: () => sdk.PrivateKey.fromString(privateKeyInput),
      ecdsa: () => sdk.PrivateKey.fromStringECDSA(privateKeyInput),
      ed25519: () => sdk.PrivateKey.fromStringED25519(privateKeyInput),
      der: () => sdk.PrivateKey.fromStringDer(privateKeyInput),
    };

    const parserOrder =
      mirrorKeyType === 'ecdsa'
        ? ['ecdsa', 'auto', 'der', 'ed25519']
        : mirrorKeyType === 'ed25519'
          ? ['ed25519', 'auto', 'der', 'ecdsa']
          : ['auto', 'ecdsa', 'ed25519', 'der'];

    let fallback = null;
    for (const parserName of parserOrder) {
      const parser = parseFns[parserName];
      if (!parser) continue;
      try {
        const candidate = parser();
        const candidatePublicKey = normalizeString(candidate.publicKey?.toStringRaw?.() || '').toLowerCase();
        if (!fallback) {
          fallback = {
            key: candidate,
            parser: parserName,
          };
        }
        if (mirrorPublicKeyHex && candidatePublicKey && candidatePublicKey === mirrorPublicKeyHex) {
          return {
            privateKey: candidate,
            parser: parserName,
            matchedMirrorKey: true,
          };
        }
      } catch {
        // Try next parser.
      }
    }

    if (fallback) {
      return {
        privateKey: fallback.key,
        parser: fallback.parser,
        matchedMirrorKey: false,
      };
    }

    throw createOrchestratorError('Unable to parse Hedera private key', 400, 'INVALID_ENV_REFS', {
      account_id: accountId,
      network: normalizeString(network || 'testnet').toLowerCase(),
    });
  }

  async publishViaHederaSdk(agent, envMap, messagePayload) {
    const accountId = envMap.hedera_account_id || envMap.hedera_operator_id;
    const privateKey = envMap.hedera_private_key || envMap.hedera_operator_key;
    if (!accountId || !privateKey) {
      return {
        ok: false,
        provider: 'hashgraph-sdk',
        error: 'Missing Hedera account credentials in env refs',
      };
    }

    let sdk;
    try {
      sdk = await import('@hashgraph/sdk');
    } catch {
      return {
        ok: false,
        provider: 'hashgraph-sdk',
        error: '@hashgraph/sdk is not installed (dependency unavailable)',
      };
    }

    const network = normalizeString(agent.network || 'testnet').toLowerCase();
    const client =
      network === 'mainnet'
        ? sdk.Client.forMainnet()
        : network === 'previewnet'
          ? sdk.Client.forPreviewnet()
          : sdk.Client.forTestnet();

    const parsedOperator = await this.resolveHederaOperatorKey(sdk, accountId, privateKey, network);
    client.setOperator(accountId, parsedOperator.privateKey);

    const publishTargets = normalizeObject(agent.publish_targets, defaultPublishTargets(agent.type));
    const hcsTarget = normalizeObject(publishTargets.hcs, {});
    let topicId = normalizeString(hcsTarget.topic_id || '');

    if (!topicId && normalizeBoolean(hcsTarget.create_if_missing, true)) {
      const topicCreateTx = new sdk.TopicCreateTransaction()
        .setTopicMemo(`SeFi Agent ${agent.id} publish channel`)
        .freezeWith(client);
      const topicCreateSubmit = await topicCreateTx.execute(client);
      const topicCreateReceipt = await topicCreateSubmit.getReceipt(client);
      topicId = normalizeString(topicCreateReceipt.topicId?.toString() || '');
    }

    if (!topicId) {
      return {
        ok: false,
        provider: 'hashgraph-sdk',
        error: 'No HCS topic configured and creation is disabled',
      };
    }

    const submitTx = await new sdk.TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(Buffer.from(JSON.stringify(messagePayload), 'utf8'))
      .execute(client);
    const submitReceipt = await submitTx.getReceipt(client);

    this.database.upsertAgentTopicRegistration({
      agent_id: agent.id,
      network,
      topic_id: topicId,
      label: sanitizeLabel(`SeFi Agent Topic (${agent.name})`),
    });

    try {
      this.indexer.refreshManifests();
    } catch (error) {
      this.logger.warn?.('agent_topic_refresh_failed', {
        agent_id: agent.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const nextPublishTargets = {
      ...publishTargets,
      hcs: {
        ...hcsTarget,
        topic_id: topicId,
      },
    };
    this.database.updateAgent(agent.id, {
      publish_targets: nextPublishTargets,
    });

    return {
      ok: true,
      provider: 'hashgraph-sdk',
      key_parser: parsedOperator.parser,
      network,
      topic_id: topicId,
      tx_id: submitTx.transactionId?.toString?.() || null,
      receipt_status: submitReceipt.status?.toString?.() || 'UNKNOWN',
    };
  }

  async publishToHcs(agent, payload) {
    if (agent.type === 'hedera') {
      this.assertAutonomousPolicy(agent);
    }

    const envResolution = this.resolveEnvMap(agent);
    if (envResolution.missing.length > 0) {
      return {
        ok: false,
        provider: 'none',
        error: 'Missing required env refs for HCS publish',
        missing: envResolution.missing,
      };
    }

    return this.publishViaHederaSdk(agent, envResolution.envMap, payload);
  }

  buildElizaCharacter(agent) {
    const publishTargets = normalizeObject(agent.publish_targets, defaultPublishTargets(agent.type));
    return {
      id: agent.id,
      name: agent.name,
      system: agent.system_prompt || 'You are a SeFi Eliza agent.',
      bio: [
        `Network focus: ${agent.network}`,
        `Model: ${agent.model_provider}/${agent.model_name}`,
      ],
      topics: normalizeArray(agent.topics),
      postExamples: normalizeArray(agent.post_examples),
      style: {
        post: ['Cite semantic metrics', 'Stay concise', 'Avoid unsupported claims'],
      },
      plugins: uniqueStrings([
        '@elizaos/plugin-bootstrap',
        '@elizaos/plugin-hedera',
        'plugin-sefi-semantic',
        normalizeBoolean(publishTargets.twitter?.enabled, false) ? '@elizaos/plugin-twitter' : '',
      ]),
      settings: {
        secrets: normalizeArray(agent.env_refs).reduce((acc, item) => {
          if (!item?.key || !item?.env_var_name) return acc;
          acc[item.key] = item.env_var_name;
          return acc;
        }, {}),
      },
    };
  }

  async elizaRequest(path, init = {}) {
    const base = normalizeString(this.config.elizaBaseUrl || 'http://127.0.0.1:3001').replace(/\/+$/, '');
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    };
    if (this.config.elizaApiKey) {
      headers.Authorization = `Bearer ${this.config.elizaApiKey}`;
      headers['x-api-key'] = this.config.elizaApiKey;
    }
    const response = await this.fetchImpl(`${base}${path}`, {
      ...init,
      headers,
    });
    const isJson = String(response.headers?.get?.('content-type') || '').includes('application/json');
    const payload = isJson ? await response.json() : await response.text();
    if (!response.ok) {
      throw createOrchestratorError(
        `Eliza request failed (${response.status})`,
        502,
        'ELIZA_REQUEST_FAILED',
        payload
      );
    }
    return payload;
  }

  async syncElizaAgent(agent) {
    try {
      const character = this.buildElizaCharacter(agent);
      await this.elizaRequest('/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          id: agent.id,
          name: agent.name,
          character,
        }),
      });
      await this.elizaRequest(`/api/agents/${encodeURIComponent(agent.id)}/start`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async stopElizaAgent(agent) {
    try {
      await this.elizaRequest(`/api/agents/${encodeURIComponent(agent.id)}/stop`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async publishToTwitterViaEliza(agent, payload) {
    try {
      const response = await this.elizaRequest(`/api/agents/${encodeURIComponent(agent.id)}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          task_type: 'twitter_post',
          payload,
        }),
      });
      return {
        ok: true,
        provider: 'eliza',
        response,
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'eliza',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async publishTest(agentId, input = {}, runOptions = {}) {
    const agent = this.getAgent(agentId);
    const runId = crypto.randomUUID();
    const runMode = normalizeString(runOptions.mode || 'manual');
    const triggerSource = normalizeString(runOptions.trigger_source || 'publish_test');
    const runSummary = normalizeString(runOptions.summary || 'Running publish test');
    this.database.createAgentRun({
      id: runId,
      agent_id: agent.id,
      status: 'running',
      mode: runMode,
      trigger_source: triggerSource,
      summary: runSummary,
      details: null,
      started_at: nowIso(),
      finished_at: null,
    });

    try {
      const question = parseQuestion(input.question);
      let semanticResult = null;

      if (question) {
        try {
          semanticResult = await this.agentService.ask(question, {
            auto_execute: true,
            strong_model: normalizeBoolean(input.strong_model, false),
            allow_sql_fallback: false,
            max_rows: 200,
          });
        } catch (error) {
          this.database.createAgentEvent({
            agent_id: agent.id,
            run_id: runId,
            event_type: 'semantic_query_warning',
            level: 'warning',
            message: `Semantic query failed during publish test: ${error.message}`,
            payload: null,
          });
        }
      }

      const structuredPayload = this.buildStructuredSemanticPayload(agent, {
        source_query: question || 'agent publish test',
        summary:
          normalizeString(input.summary) ||
          normalizeString(semanticResult?.plan?.explanation) ||
          `SeFi indexed ${this.database.getOverview().records_indexed} records.`,
        voice_text: normalizeString(input.voice_text),
      });

      const hcsEnabled = normalizeBoolean(agent.publish_targets?.hcs?.enabled, true);
      const twitterEnabled = normalizeBoolean(agent.publish_targets?.twitter?.enabled, false) && agent.type === 'elizaos';

      const hcsResult = hcsEnabled
        ? await this.publishToHcs(agent, structuredPayload)
        : { ok: false, provider: 'none', skipped: true, reason: 'hcs disabled' };

      const twitterPayload = {
        summary_text: structuredPayload.summary_text,
        voice_text: structuredPayload.voice_text,
        metric_snapshot: structuredPayload.metric_snapshot,
      };
      const twitterResult = twitterEnabled
        ? await this.publishToTwitterViaEliza(agent, twitterPayload)
        : { ok: false, provider: 'none', skipped: true, reason: 'twitter disabled or unsupported' };

      const success = Boolean(hcsResult.ok || twitterResult.ok);
      const summary = success ? 'Publish test completed' : 'Publish test did not reach any target channel';
      const details = {
        semantic_result: semanticResult
          ? {
              request_id: semanticResult.request_id,
              mode: semanticResult.plan?.mode,
              validation: semanticResult.validation,
            }
          : null,
        structured_payload: structuredPayload,
        channels: {
          hcs: hcsResult,
          twitter: twitterResult,
        },
      };

      this.database.finishAgentRun(runId, {
        status: success ? 'success' : 'warning',
        summary,
        details,
        finished_at: nowIso(),
      });
      const updated = this.database.setAgentRuntimeStatus(agent.id, success ? 'running' : 'degraded', {
        status: success ? 'success' : 'warning',
        message: summary,
        channels: details.channels,
      });

      this.database.createAgentEvent({
        agent_id: agent.id,
        run_id: runId,
        event_type: 'publish_test',
        level: success ? 'info' : 'warning',
        message: summary,
        payload: details.channels,
      });

      return {
        run_id: runId,
        summary,
        success,
        agent: updated,
        ...details,
      };
    } catch (error) {
      this.database.finishAgentRun(runId, {
        status: 'error',
        summary: error.message,
        details: error.details || null,
        finished_at: nowIso(),
      });
      this.database.setAgentRuntimeStatus(agent.id, 'degraded', {
        status: 'error',
        message: error.message,
      });
      this.database.createAgentEvent({
        agent_id: agent.id,
        run_id: runId,
        event_type: 'publish_test_failed',
        level: 'error',
        message: error.message,
        payload: error.details || null,
      });
      throw error;
    }
  }

  async runScheduledAutomation(agentId) {
    const agent = this.getAgent(agentId);
    const schedule = normalizeObject(agent.schedule, {});
    const action = normalizeString(schedule.action || 'publish_test').toLowerCase();

    if (action === 'bonzo_clmm_guard') {
      return this.runBonzoClmmGuard(agentId, {
        mode: 'scheduled',
        trigger_source: 'schedule',
      });
    }

    return this.publishTest(
      agentId,
      {
        question: normalizeString(schedule.question || 'Generate the latest protocol automation summary.'),
        summary: normalizeString(
          schedule.summary || `Scheduled automation run for ${agent.name}`
        ),
        voice_text: normalizeString(schedule.voice_text || 'Operator-ready update.'),
        strong_model: normalizeBoolean(schedule.strong_model, false),
      },
      {
        mode: 'scheduled',
        trigger_source: 'schedule',
        summary: 'Running scheduled automation',
      }
    );
  }
}
