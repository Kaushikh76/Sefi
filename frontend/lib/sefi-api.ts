const EXPLICIT_API_BASE = process.env.NEXT_PUBLIC_SEFI_API_BASE?.trim() || '';
const LOCAL_API_BASE = 'http://localhost:3210/api/v1';
export const API_BASE =
  EXPLICIT_API_BASE ||
  (typeof window !== 'undefined'
    ? '/api/v1'
    : LOCAL_API_BASE);
const API_TOKEN = process.env.NEXT_PUBLIC_SEFI_API_TOKEN || '';

const READ_RETRY_DELAYS_MS = [250, 750];
const READ_TIMEOUT_MS = 7000;
const WRITE_TIMEOUT_MS = 15000;
const AGENT_CHAT_WRITE_TIMEOUT_MS = 120000;
const SESSION_TIMEOUT_MS = 7000;

let apiSessionReady = false;
let apiSessionPromise: Promise<void> | null = null;

function isBrowser() {
  return typeof window !== 'undefined';
}

async function bootstrapApiSession() {
  if (!isBrowser()) return;
  if (!API_TOKEN) return;
  if (apiSessionReady) return;

  if (apiSessionPromise) {
    return apiSessionPromise;
  }

  apiSessionPromise = (async () => {
    const request = withTimeoutSignal(null, SESSION_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}/auth/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sefi-api-token': API_TOKEN,
        },
        body: JSON.stringify({ token: API_TOKEN }),
        credentials: 'include',
        signal: request.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Session bootstrap failed with status ${response.status}`);
      }

      apiSessionReady = true;
    } finally {
      request.clear();
      apiSessionPromise = null;
    }
  })();

  return apiSessionPromise;
}

export async function ensureApiSession() {
  if (!isBrowser()) return;
  await bootstrapApiSession();
}

function shouldSendHeaderToken() {
  if (!API_TOKEN) return false;
  if (!isBrowser()) return true;
  return !apiSessionReady;
}

export function getStatusStreamUrl() {
  return `${API_BASE}/status/stream`;
}

export function getRealtimeStreamUrl(channels: Array<'index' | 'api' | 'activity'> = ['index', 'api', 'activity']) {
  const encoded = encodeURIComponent(channels.join(','));
  return `${API_BASE}/realtime/stream?channels=${encoded}`;
}

export function getAgentChatStreamUrl(sessionId: string, options: { recent?: boolean } = {}) {
  const query = options.recent ? '?recent=true' : '';
  return `${API_BASE}/agents/chat/sessions/${encodeURIComponent(sessionId)}/stream${query}`;
}

export function streamChatTurn(sessionId: string, options: { recent?: boolean } = {}) {
  return getAgentChatStreamUrl(sessionId, options);
}

export type OverviewResponse = {
  database: {
    size_mb: number;
    usage_percent: number;
    total_contract_logs: number;
    total_hts_transfers: number;
    total_erc20_transfers: number;
    total_topic_messages: number;
    total_contracts: number;
    is_full: boolean;
  };
  stats: Record<string, string>;
  records_indexed: number;
};

export type StatusResponse = {
  isRunning: boolean;
  mode: 'idle' | 'sync' | 'listen';
  network: string;
  networks?: string[];
  protocol?: string;
  backend_status?: 'starting' | 'up' | 'degraded' | 'down';
  db_status?: 'starting' | 'up' | 'degraded' | 'down';
  cube_status?: 'starting' | 'up' | 'degraded' | 'down';
  backend_last_ok_at?: string | null;
  cube_last_ok_at?: string | null;
  db_last_read_ok_at?: string | null;
  db_last_read_error?: string | null;
  db_last_read_error_at?: string | null;
  db_last_read_duration_ms?: number | null;
  status_age_ms?: number;
  source?: string;
  timestamp?: string;
  uptime_seconds?: number;
  mirrorRestBaseUrl: string;
  totalApiCalls: number;
  lastRateLimitTime: string | null;
  manifests: {
    loaded: Array<{ fileName: string; protocol?: string; contractCount?: number; activeNetwork?: string }>;
    skipped?: Array<{ fileName: string; reason: string }>;
    totals: { contracts: number; tokens: number; topics: number };
  };
  database: {
    size_mb: number;
    usage_percent: number;
    total_contract_logs: number;
    total_hts_transfers: number;
    total_erc20_transfers: number;
    total_topic_messages: number;
    total_contracts: number;
  };
  stats: Record<string, string>;
  sync?: {
    target: 'all' | 'contracts' | 'hts' | 'topics' | 'listen' | null;
    phase: 'contracts' | 'hts' | 'topics' | 'idle';
    phase_started_at: string | null;
    phase_progress: {
      current: number;
      total: number;
      entity_type: string | null;
      entity_id: string | null;
      entity_name: string | null;
      last_timestamp: string | null;
    } | null;
  };
  records_indexed?: number;
  persistence?: {
    is_saving: boolean;
    last_save_at: string | null;
    last_save_duration_ms: number;
    last_save_error: string | null;
    effective_save_interval_ms: number;
    effective_save_debounce_ms: number;
  };
  cube?: CubeHealthResponse;
  cube_health?: CubeHealthResponse;
};

export type ContractProgress = {
  contract_id: string;
  name: string;
  canonical_name: string | null;
  category: string;
  evm_address: string | null;
  asset: string | null;
  source_file: string | null;
  items_synced: number;
  last_timestamp: string;
  last_tx_id: string;
  last_index: number;
  updated_at: string | null;
};

export type ActivityRecord = {
  id: number;
  event_type: string;
  entity_name: string | null;
  message: string;
  timestamp: string;
};

export type CubeHealthResponse = {
  status: string;
  http_status: number;
  latency_ms: number;
  cube_api_url?: string;
  source?: string;
  timeout_ms?: number;
  error?: string;
  cache?: {
    hit: boolean;
    ttl_ms_remaining: number;
  };
};

export type HealthResponse = {
  status: string;
  network: string;
  networks?: string[];
  backend_status?: 'starting' | 'up' | 'degraded' | 'down';
  db_status?: 'starting' | 'up' | 'degraded' | 'down';
  cube_status?: 'starting' | 'up' | 'degraded' | 'down';
  backend_last_ok_at?: string | null;
  cube_last_ok_at?: string | null;
  db_last_read_ok_at?: string | null;
  db_last_read_error?: string | null;
  status_age_ms?: number;
  source?: string;
  cube?: CubeHealthResponse;
  cube_health?: CubeHealthResponse;
};

export type AuthStateResponse = {
  demo_mode: boolean;
  auth_enabled: boolean;
  require_auth: boolean;
  full_access: boolean;
  access_level: 'demo' | 'full';
  can_login: boolean;
  allowed_demo_features: string[];
  contact_email: string;
  session: {
    id: string;
    access_level: 'demo' | 'full';
    auth_mode: string | null;
    created_at: string | null;
    expires_at: string | null;
  } | null;
};

export type RecordType = 'contract_logs' | 'hts_transfers' | 'topic_messages' | 'erc20_transfers';

export type CubeMetaResponse = {
  cubes?: Array<{
    name: string;
    title?: string;
    measures?: Array<{ name: string; title?: string; type?: string }>;
    dimensions?: Array<{ name: string; title?: string; type?: string }>;
  }>;
};

export type SqliteSchemaResponse = {
  database_path: string;
  table_count: number;
  tables: Array<{
    name: string;
    sql: string;
    columns: Array<{
      cid: number;
      name: string;
      type: string;
      notnull: boolean;
      default_value: string | null;
      primary_key: boolean;
    }>;
  }>;
};

export type ModelingPreviewResponse = {
  preview_id: string;
  generated_at: string;
  generated_root: string;
  summary: {
    tables_discovered: number;
    files_new: number;
    files_changed: number;
    files_unchanged: number;
    files_removed: number;
  };
  files: Array<{
    table_name: string;
    cube_name: string;
    file_name: string;
    file_path: string;
    status: 'new' | 'changed' | 'unchanged';
    previous_content: string | null;
    content: string;
  }>;
  removed_files: Array<{ file_name: string; file_path: string }>;
};

export type ModelingApplyResponse = {
  preview_id: string;
  applied_at: string;
  summary: {
    tables_discovered: number;
    files_new: number;
    files_changed: number;
    files_unchanged: number;
    files_removed: number;
  };
  writes_applied: number;
  removals_applied: number;
  unchanged_files: number;
  generated_root: string;
  refresh_hint: string;
};

export type SqliteQueryResponse = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  total_rows: number;
  returned_rows: number;
  truncated: boolean;
  max_rows: number;
  sql: string;
};

export type ModelFileScope = 'all' | 'generated' | 'curated';

export type ModelFileRecord = {
  path: string;
  file_path: string;
  scope: 'generated' | 'curated';
  size_bytes: number;
  updated_at: string;
};

export type ModelFilesResponse = {
  model_root: string;
  generated_root: string;
  scope: ModelFileScope;
  count: number;
  files: ModelFileRecord[];
};

export type ModelFileContentResponse = {
  model_root: string;
  path: string;
  file_path: string;
  content: string;
  size_bytes: number;
  updated_at: string;
};

export type ModelStorageStatusResponse = {
  model_root: string;
  generated_root: string;
  model_root_exists: boolean;
  generated_root_exists: boolean;
  model_root_writable: boolean;
  generated_root_writable: boolean;
  file_count: number;
  generated_file_count: number;
  curated_file_count: number;
  persistence: {
    mode: string;
    hint: string;
    backend_model_dir: string;
  };
};

export type CubeSqlNormalized = {
  status: string;
  query_type: string | null;
  sql_text: string | null;
  sql_params: unknown;
  error: string | null;
  warnings: string[];
};

export type CubeQueryProxyResponse = {
  query_type: 'load' | 'sql' | string;
  attempts: number;
  continue_wait_count: number;
  normalized_sql?: CubeSqlNormalized | null;
  payload: Record<string, unknown>;
};

export type ModelingAiDraftRecord = {
  draft_id: string;
  intent_text: string;
  constraints_text: string;
  target_path: string;
  generated_yaml: string;
  rationale: string;
  warnings: string[];
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    cube_count?: number;
    resolved_path?: {
      model_root: string;
      path: string;
      file_path: string;
    } | null;
    [key: string]: unknown;
  };
  context_hash: string;
  llm_model: string | null;
  status: string;
  approved_path: string | null;
  created_at: string | null;
  approved_at: string | null;
};

export type ModelingAiGenerateResponse = {
  draft: ModelingAiDraftRecord;
  cube_meta_source: string;
};

export type ModelingAiApproveResponse = {
  draft: ModelingAiDraftRecord;
  save: {
    model_root: string;
    path: string;
    file_path: string;
    created: boolean;
    updated_at: string;
    size_bytes: number;
  } | null;
  already_approved: boolean;
  cube_refresh: {
    status: string;
    cube_count?: number;
    error?: string;
  } | null;
};

export type ApiEndpointParam = {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description?: string;
  default?: string | number | boolean | null;
};

export type ApiEndpointRecord = {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  query_template: Record<string, unknown>;
  params_schema: ApiEndpointParam[];
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ApiEndpointListResponse = {
  count: number;
  records: ApiEndpointRecord[];
};

export type ApiEndpointRunResponse = {
  endpoint: {
    id: string;
    slug: string;
    name: string;
  };
  query_type: 'load' | 'sql' | string;
  params_used: Record<string, unknown>;
  param_warnings: string[];
  query: Record<string, unknown>;
  continue_wait_count: number;
  attempts: number;
  normalized_sql: CubeSqlNormalized | null;
  payload: Record<string, unknown>;
};

export type DerivedAuthMode = 'none' | 'api_key' | 'bearer';

export type DerivedExternalSource = {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  is_system: boolean;
  preset_key: string | null;
  base_url: string;
  auth_mode: DerivedAuthMode;
  auth_config: Record<string, unknown>;
  request: Record<string, unknown>;
  normalization: Record<string, unknown>;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type DerivedExternalSourceRun = {
  id: string;
  source_id: string;
  status: string;
  trigger_source: string | null;
  http_status: number | null;
  records_fetched: number;
  error: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
};

export type DerivedPipeline = {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  realtime_enabled: boolean;
  is_system: boolean;
  preset_key: string | null;
  target_table: string;
  schedule: Record<string, unknown>;
  spec: Record<string, unknown>;
  last_run_at: string | null;
  last_run_status: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  cursor: string | null;
};

export type DerivedPipelineRun = {
  id: string;
  pipeline_id: string;
  status: string;
  trigger_source: string;
  rows_read: number;
  rows_written: number;
  cursor_before: string | null;
  cursor_after: string | null;
  details: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
};

export type DerivedListSourcesResponse = {
  count: number;
  records: DerivedExternalSource[];
};

export type DerivedListSourceRunsResponse = {
  count: number;
  records: DerivedExternalSourceRun[];
};

export type DerivedListPipelinesResponse = {
  count: number;
  records: DerivedPipeline[];
};

export type DerivedListPipelineRunsResponse = {
  count: number;
  records: DerivedPipelineRun[];
};

export type DerivedStatusResponse = {
  enabled: boolean;
  initialized_at: string | null;
  last_realtime_run_at: string | null;
  last_reconcile_at: string | null;
  last_error: string | null;
  pipelines_total: number;
  pipelines_enabled: number;
  sources_total: number;
  sources_enabled: number;
  runs_total: number;
  failed_runs: number;
  last_pipeline_run_at: string | null;
  max_lag_ms: number | null;
  batch_size: number;
  reconcile_cron: string;
};

export type DerivedSourceTestResponse = {
  run: DerivedExternalSourceRun | null;
  source: DerivedExternalSource | null;
  sample_records: Array<Record<string, unknown>>;
  records_fetched: number;
};

export type DerivedPipelineExecuteResponse = {
  run: DerivedPipelineRun | null;
  pipeline: DerivedPipeline | null;
  preview_rows: Array<Record<string, unknown>>;
};

export type DerivedPipelineRunAllItem = {
  pipeline_id: string;
  pipeline_slug: string;
  status: string;
  run_id: string | null;
  rows_read: number;
  rows_written: number;
  error: string | null;
};

export type DerivedPipelineRunAllResponse = {
  trigger_source: string;
  reconcile: boolean;
  limit: number;
  started_at: string;
  finished_at: string;
  total: number;
  success_count: number;
  failed_count: number;
  results: DerivedPipelineRunAllItem[];
};

export type FrontendCatalogResponse = {
  generated_at: string;
  cubes: {
    source: string;
    error: string | null;
    count: number;
    records: Array<{
      name: string;
      title: string | null;
      measures: Array<{ name: string; title: string | null; type: string | null }>;
      dimensions: Array<{ name: string; title: string | null; type: string | null }>;
    }>;
  };
  derived: {
    status: DerivedStatusResponse;
    pipelines: Array<{
      id: string;
      slug: string;
      name: string;
      preset_key: string | null;
      target_table: string;
      enabled: boolean;
      realtime_enabled: boolean;
      is_system: boolean;
      last_run_at: string | null;
      last_run_status: string | null;
      last_error: string | null;
      cursor: string | null;
      is_builtin_cube_product: boolean;
    }>;
    sources: Array<{
      id: string;
      slug: string;
      name: string;
      enabled: boolean;
      is_system: boolean;
      preset_key: string | null;
      base_url: string;
      auth_mode: DerivedAuthMode;
      last_success_at: string | null;
      last_error: string | null;
    }>;
  };
  modes: {
    pipeline_lifecycle: string[];
    agent_operations: string[];
  };
  agent_defaults: {
    frontend_agent_id: string;
    auto_execute: boolean;
    allow_sql_fallback: boolean;
    max_rows: number;
    created: boolean;
  };
};

export type FrontendVaultSummary = {
  vault_address: string | null;
  vault_name: string | null;
  strategy_address: string | null;
  pool_address: string | null;
  asset_pair: string | null;
  current_tick: number | null;
  active_lower_tick: number | null;
  active_upper_tick: number | null;
  in_range: boolean;
  idle_ratio: number | null;
  deployed_ratio: number | null;
  tvl_usd: number | null;
  share_price: number | null;
  rebalance_count_24h: number | null;
  state_at: string | null;
  indexed_at: string | null;
};

export type FrontendVaultListResponse = {
  count: number;
  records: FrontendVaultSummary[];
  sort: string;
  limit: number;
};

export type FrontendVaultOverview = {
  vault: {
    vault_address: string | null;
    vault_name: string | null;
    strategy_address: string | null;
    pool_address: string | null;
    asset_pair: string | null;
  };
  state: {
    current_tick: number | null;
    active_lower_tick: number | null;
    active_upper_tick: number | null;
    in_range: boolean;
    idle_ratio: number | null;
    deployed_ratio: number | null;
    tvl_usd: number | null;
    share_price: number | null;
    rebalance_count_24h: number | null;
    last_rebalance_at: string | null;
    state_at: string | null;
    indexed_at: string | null;
  };
  positions: {
    total_positions: number;
    active_positions: number;
    last_position_update: string | null;
  };
  actions: {
    latest_action_at: string | null;
    count_last_24h: number;
  };
  latest_pool_snapshot: {
    pool_address: string | null;
    dex_name: string | null;
    token0_symbol: string | null;
    token1_symbol: string | null;
    current_tick: number | null;
    spot_price: number | null;
    tvl_usd: number | null;
    snapshot_at: string | null;
    indexed_at: string | null;
  } | null;
};

export type FrontendVaultPositionsResponse = {
  vault_address: string;
  count: number;
  limit: number;
  records: Array<{
    position_id: string | null;
    pool_address: string | null;
    vault_address: string | null;
    strategy_address: string | null;
    owner_address: string | null;
    token0_symbol: string | null;
    token1_symbol: string | null;
    tick_lower: number | null;
    tick_upper: number | null;
    range_width: number | null;
    liquidity: number | null;
    amount0: number | null;
    amount1: number | null;
    fees_owed0: number | null;
    fees_owed1: number | null;
    is_active: boolean;
    minted_at: string | null;
    last_updated_at: string | null;
    indexed_at: string | null;
  }>;
};

export type FrontendVaultActionFeed = {
  vault_address: string;
  count: number;
  limit: number;
  days: number;
  anchored_window_start: string | null;
  records: Array<{
    action_id: string | null;
    vault_address: string | null;
    strategy_address: string | null;
    pool_address: string | null;
    tx_hash: string | null;
    actor_address: string | null;
    action_type: string | null;
    position_id: string | null;
    tick_lower: number | null;
    tick_upper: number | null;
    amount0: number | null;
    amount1: number | null;
    shares: number | null;
    value_usd: number | null;
    block_number: number | null;
    action_at: string | null;
    indexed_at: string | null;
  }>;
};

export type FrontendVaultRiskSnapshot = {
  vault_address: string | null;
  vault_name: string | null;
  asset_pair: string | null;
  in_range: boolean;
  nearest_boundary_distance: number | null;
  realized_vol_1h: number | null;
  realized_vol_6h: number | null;
  realized_vol_24h: number | null;
  tvl_usd: number | null;
  idle_ratio: number | null;
  deployed_ratio: number | null;
  latest_volatility_snapshot_at: string | null;
  state_at: string | null;
  indexed_at: string | null;
};

export type FrontendAgentBootstrapResponse = {
  created: boolean;
  agent: ManagedAgentRecord;
};

export type AgentChatSessionRecord = {
  id: string;
  agent_id: string;
  title: string | null;
  mode: string;
  metadata: Record<string, unknown>;
  auto_execute: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_message_at: string | null;
};

export type AgentChatMessageRecord = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string | null;
};

export type AgentChatEvent = {
  id: number;
  session_id: string;
  message_id: string | null;
  event_type: string;
  level: string;
  payload: Record<string, unknown>;
  created_at: string | null;
};

export type AgentConfirmationChallenge = {
  confirmation_token: string;
  action: string;
  reason: string;
  issued_at: string;
  expires_at: string;
};

export type AgentToolCall = {
  tool: string;
  action?: string;
  pipeline_id?: string;
  pipeline_slug?: string;
  source_id?: string;
  source_slug?: string;
};

export type AgentChatTurnResponse = {
  session: AgentChatSessionRecord;
  user_message: AgentChatMessageRecord;
  assistant_message: AgentChatMessageRecord;
  turn: {
    mode: string;
    intent: string;
    tool_call: AgentToolCall;
    result: Record<string, unknown> & {
      requires_confirmation?: boolean;
      confirmation?: AgentConfirmationChallenge;
    };
  };
};

export type AgentChatMessagesResponse = {
  count: number;
  records: AgentChatMessageRecord[];
};

export type AgentChatCompletionsResponse = {
  request_id: string;
  stateless: boolean;
  question: string;
  intent: string;
  mode: string;
  tool_call: AgentToolCall;
  result: Record<string, unknown>;
};

export type AgentRequestOptions = {
  auto_execute?: boolean;
  strong_model?: boolean;
  allow_sql_fallback?: boolean;
  max_rows?: number;
};

export type AgentPlan = {
  mode: 'cube_query' | 'clarification' | 'sql_fallback';
  explanation: string;
  confidence: number;
  cube_query: Record<string, unknown> | null;
  sql_fallback: string | null;
  clarification_question: string | null;
};

export type AgentPlaygroundContextResponse = {
  generated_at: string;
  metadata_source?: string;
  metadata_warning?: string | null;
  cube_count: number;
  measure_count: number;
  dimension_count: number;
  cubes: Array<{
    name: string;
    title: string | null;
    measures: Array<{ name: string; title: string | null; type: string | null }>;
    dimensions: Array<{ name: string; title: string | null; type: string | null }>;
  }>;
  defaults: {
    auto_execute: boolean;
    allow_sql_fallback: boolean;
  };
};

export type AgentAskResponse = {
  request_id: string;
  question: string;
  options: {
    strongModel: boolean;
    autoExecute: boolean;
    allowSqlFallback: boolean;
    maxRows: number;
  };
  context_summary: {
    metadata_source?: string;
    metadata_warning?: string | null;
    cube_count: number;
    measure_count: number;
    dimension_count: number;
  };
  plan: AgentPlan;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  llm: {
    model: string;
  };
  executed: boolean;
  execution?: AgentExecuteResponse;
};

export type AgentExecuteResponse = {
  executed: boolean;
  mode: 'cube_query' | 'clarification' | 'sql_fallback';
  result?: Record<string, unknown>;
  clarification_question?: string | null;
};

export type ManagedAgentType = 'hedera' | 'elizaos';
export type ManagedAgentRuntimeStatus = 'stopped' | 'running' | 'degraded';

export type ManagedAgentEnvRef = {
  key: string;
  env_var_name: string;
  required: boolean;
  description?: string;
};

export type ManagedAgentToolConfig = {
  tool_key: string;
  enabled: boolean;
  config?: Record<string, unknown>;
};

export type ManagedAgentSchedule = {
  schedule_key?: string;
  cron?: string;
  enabled?: boolean;
  timezone?: string;
  [key: string]: unknown;
};

export type ManagedAgentTopicRegistration = {
  agent_id: string;
  network: string;
  topic_id: string;
  label: string | null;
  created_at: string | null;
};

export type ManagedAgentTopicRecord = ManagedAgentTopicRegistration & {
  agent_name: string | null;
  explorer_url: string;
};

export type ManagedAgentRun = {
  id: string;
  agent_id: string;
  status: string;
  mode: string;
  trigger_source: string;
  summary: string;
  details: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
};

export type ManagedAgentEvent = {
  id: number;
  agent_id: string;
  run_id: string | null;
  event_type: string;
  level: string;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};

export type ManagedAgentRecord = {
  id: string;
  name: string;
  type: ManagedAgentType;
  network: string;
  model_provider: string;
  model_name: string;
  system_prompt: string;
  topics: string[];
  post_examples: string[];
  semantic_scope: Record<string, unknown>;
  tool_allowlist: string[];
  publish_targets: Record<string, unknown>;
  schedule: Record<string, unknown>;
  env_refs: ManagedAgentEnvRef[];
  tool_configs: ManagedAgentToolConfig[];
  schedules: ManagedAgentSchedule[];
  topic_registrations: ManagedAgentTopicRegistration[];
  runtime_status: ManagedAgentRuntimeStatus | string;
  last_run_summary: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  run_count: number;
  event_count: number;
  last_run_at: string | null;
};

export type ManagedAgentCreateInput = {
  id?: string;
  name: string;
  type: ManagedAgentType;
  network?: string;
  model_provider?: string;
  model_name?: string;
  system_prompt?: string;
  topics?: string[];
  post_examples?: string[];
  semantic_scope?: Record<string, unknown>;
  tool_allowlist?: string[];
  publish_targets?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  env_refs?: ManagedAgentEnvRef[];
};

export type ManagedAgentUpdateInput = Partial<ManagedAgentCreateInput> & {
  runtime_status?: string;
  last_run_summary?: Record<string, unknown> | null;
};

export type AgentTemplatesResponse = {
  templates: Array<{
    key: string;
    label: string;
    description: string;
    prompt_suffix: string;
  }>;
};

export type ManagedAgentListResponse = {
  count: number;
  records: ManagedAgentRecord[];
};

export type ManagedAgentActivityResponse = {
  count: number;
  records: ManagedAgentEvent[];
};

export type ManagedAgentRunsResponse = {
  count: number;
  records: ManagedAgentRun[];
};

export type ManagedAgentTopicsResponse = {
  count: number;
  records: ManagedAgentTopicRecord[];
};

export type AgentBrainstormResponse = {
  template: {
    key: string;
    label: string;
    description: string;
    prompt_suffix: string;
  };
  agent: ManagedAgentRecord;
  brainstorm: Record<string, unknown>;
};

export type AgentPublishTestResponse = {
  run_id: string;
  summary: string;
  success: boolean;
  agent: ManagedAgentRecord;
  semantic_result: Record<string, unknown> | null;
  structured_payload: Record<string, unknown>;
  channels: Record<string, unknown>;
};

export type BonzoBootstrapResponse = {
  created: boolean;
  agent: ManagedAgentRecord;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReadMethod(method?: string) {
  const normalized = String(method || 'GET').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

function withTimeoutSignal(existingSignal: AbortSignal | null | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);

  const onAbort = () => {
    try {
      // preserve abort reason when available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      controller.abort((existingSignal as any)?.reason);
    } catch {
      controller.abort();
    }
  };

  if (existingSignal) {
    if (existingSignal.aborted) {
      onAbort();
    } else {
      existingSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const clear = () => {
    clearTimeout(timeoutId);
    if (existingSignal) {
      existingSignal.removeEventListener('abort', onAbort);
    }
  };

  return {
    signal: controller.signal,
    clear,
  };
}

type FetchJsonInit = RequestInit & {
  timeoutMs?: number;
};

async function fetchJson<T>(path: string, init?: FetchJsonInit): Promise<T> {
  if (isBrowser()) {
    try {
      await ensureApiSession();
    } catch {
      // Fall back to header-token mode when session bootstrap fails.
    }
  }

  const timeoutOverride = Number(init?.timeoutMs);
  const fetchInit: RequestInit = {
    ...(init || {}),
  };
  delete (fetchInit as { timeoutMs?: number }).timeoutMs;

  const method = String(fetchInit.method || 'GET').toUpperCase();
  const readMethod = isReadMethod(method);
  const requestHeaders: Record<string, string> = {
    ...(fetchInit.headers as Record<string, string> | undefined),
  };

  if (!readMethod && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  if (shouldSendHeaderToken()) {
    requestHeaders['x-sefi-api-token'] = API_TOKEN;
  }

  const maxAttempts = readMethod ? READ_RETRY_DELAYS_MS.length + 1 : 1;
  const timeoutMs =
    Number.isFinite(timeoutOverride) && timeoutOverride > 0
      ? timeoutOverride
      : (readMethod ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const request = withTimeoutSignal(fetchInit.signal ?? null, timeoutMs);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...fetchInit,
        method,
        headers: requestHeaders,
        signal: request.signal,
        cache: 'no-store',
        credentials: 'include',
      });

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        const retryableStatus = readMethod && [429, 502, 503, 504].includes(response.status);
        if (retryableStatus && attempt < maxAttempts) {
          await sleep(READ_RETRY_DELAYS_MS[attempt - 1] || 1000);
          continue;
        }

        if (contentType.includes('application/json')) {
          const payload = (await response.json()) as {
            request_id?: string;
            error?: { message?: string; details?: unknown };
          };
          const message = payload?.error?.message || `Request failed with status ${response.status}`;
          const requestSuffix = payload?.request_id ? ` (request ${payload.request_id})` : '';
          throw new Error(`${message}${requestSuffix}`);
        }

        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      if (!contentType.includes('application/json')) {
        return {} as T;
      }

      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      if (!readMethod || attempt >= maxAttempts) {
        throw error instanceof Error ? error : new Error('Request failed');
      }
      await sleep(READ_RETRY_DELAYS_MS[attempt - 1] || 1000);
    } finally {
      request.clear();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

export async function getStatus() {
  return fetchJson<StatusResponse>('/status');
}

export async function getOverview() {
  return fetchJson<OverviewResponse>('/metrics/overview');
}

export async function getHealth() {
  return fetchJson<HealthResponse>('/health');
}

export async function getAuthState() {
  return fetchJson<AuthStateResponse>('/auth/state');
}

export async function loginForFullAccess(secret: string) {
  const normalizedSecret = String(secret || '').trim();
  return fetchJson<{ success: boolean; auth_mode: string; access_level: 'demo' | 'full'; expires_at: string }>(
    '/auth/session',
    {
      method: 'POST',
      body: JSON.stringify({ access_key: normalizedSecret, token: normalizedSecret }),
    }
  );
}

export async function logoutAuthSession() {
  return fetchJson<{ success: boolean }>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getCubeHealth() {
  return fetchJson<CubeHealthResponse>('/cube/health');
}

export async function getContractsProgress() {
  return fetchJson<{ count: number; records: ContractProgress[] }>('/contracts/progress');
}

export async function getRecentRecords(type: RecordType, limit = 20) {
  return fetchJson<{ type: string; count: number; records: Array<Record<string, unknown>> }>(
    `/records/recent?type=${type}&limit=${limit}`
  );
}

export async function getActivity(limit = 50) {
  return fetchJson<ActivityRecord[]>(`/activity?limit=${limit}`);
}

export type IndexerAction = 'sync' | 'sync/contracts' | 'sync/hts' | 'sync/topics' | 'listen' | 'stop' | 'reset';

export async function triggerIndexerAction(action: IndexerAction) {
  return fetchJson<{ success?: boolean; message?: string; error?: string; mode?: string; target?: string; continuous?: boolean }>(
    `/index/${action}`,
    {
    method: 'POST',
    body: JSON.stringify({}),
    }
  );
}

export async function getCubeMeta() {
  return fetchJson<CubeMetaResponse>('/cube/meta');
}

export async function runCubeQuery(query: Record<string, unknown>, queryType: 'load' | 'sql' = 'load') {
  return fetchJson<CubeQueryProxyResponse>('/cube/query', {
    method: 'POST',
    body: JSON.stringify({ query, queryType }),
  });
}

export async function getSqliteSchema() {
  return fetchJson<SqliteSchemaResponse>('/modeling/sqlite/schema');
}

export async function createSchemaPreview() {
  return fetchJson<ModelingPreviewResponse>('/modeling/schema/preview', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function applySchemaPreview(previewId: string) {
  return fetchJson<ModelingApplyResponse>('/modeling/schema/apply', {
    method: 'POST',
    body: JSON.stringify({ preview_id: previewId }),
  });
}

export async function runSqliteQuery(sql: string, maxRows = 200) {
  return fetchJson<SqliteQueryResponse>('/modeling/sqlite/query', {
    method: 'POST',
    body: JSON.stringify({ sql, max_rows: maxRows }),
  });
}

export async function getModelStorageStatus() {
  return fetchJson<ModelStorageStatusResponse>('/modeling/models/status');
}

export async function getModelFiles(scope: ModelFileScope = 'all') {
  return fetchJson<ModelFilesResponse>(`/modeling/models?scope=${encodeURIComponent(scope)}`);
}

export async function getModelFileContent(modelPath: string) {
  return fetchJson<ModelFileContentResponse>(`/modeling/models/content?path=${encodeURIComponent(modelPath)}`);
}

export async function saveModelFile(modelPath: string, content: string) {
  return fetchJson<{ path: string; file_path: string; created: boolean; updated_at: string; size_bytes: number }>(
    '/modeling/models/content',
    {
      method: 'PUT',
      body: JSON.stringify({ path: modelPath, content }),
    }
  );
}

export async function deleteModelFile(modelPath: string) {
  return fetchJson<{ path: string; file_path: string; deleted: boolean; deleted_at: string }>('/modeling/models/content', {
    method: 'DELETE',
    body: JSON.stringify({ path: modelPath }),
  });
}

export async function generateAiModelDraft(input: { intent: string; constraints?: string; target_path?: string }) {
  return fetchJson<ModelingAiGenerateResponse>('/modeling/ai/generate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getAiModelDraft(draftId: string) {
  return fetchJson<{ draft: ModelingAiDraftRecord }>(`/modeling/ai/drafts/${encodeURIComponent(draftId)}`);
}

export async function approveAiModelDraft(input: { draft_id: string; path?: string }) {
  return fetchJson<ModelingAiApproveResponse>('/modeling/ai/approve', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listApiEndpoints() {
  return fetchJson<ApiEndpointListResponse>('/apis');
}

export async function createApiEndpoint(input: {
  name: string;
  slug?: string;
  description?: string;
  enabled?: boolean;
  query_template: Record<string, unknown>;
  params_schema?: ApiEndpointParam[];
}) {
  return fetchJson<ApiEndpointRecord>('/apis', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateApiEndpoint(
  apiId: string,
  patch: Partial<{
    name: string;
    slug: string;
    description: string;
    enabled: boolean;
    query_template: Record<string, unknown>;
    params_schema: ApiEndpointParam[];
  }>
) {
  return fetchJson<ApiEndpointRecord>(`/apis/${encodeURIComponent(apiId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteApiEndpoint(apiId: string) {
  return fetchJson<{ deleted: boolean; id: string }>(`/apis/${encodeURIComponent(apiId)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}

export async function runApiEndpointById(
  apiId: string,
  input: { params?: Record<string, unknown>; queryType?: 'load' | 'sql' } = {}
) {
  return fetchJson<ApiEndpointRunResponse>(`/apis/${encodeURIComponent(apiId)}/run`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function runApiEndpointBySlug(
  slug: string,
  input: { params?: Record<string, unknown>; queryType?: 'load' | 'sql' } = {}
) {
  return fetchJson<ApiEndpointRunResponse>(`/endpoints/${encodeURIComponent(slug)}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listDerivedSources() {
  return fetchJson<DerivedListSourcesResponse>('/derived/sources');
}

export async function listDerivedSourceRuns(sourceId: string, limit = 50) {
  return fetchJson<DerivedListSourceRunsResponse>(`/derived/sources/${encodeURIComponent(sourceId)}/runs?limit=${limit}`);
}

export async function createDerivedSource(input: {
  name: string;
  slug?: string;
  description?: string;
  enabled?: boolean;
  base_url: string;
  auth_mode?: DerivedAuthMode;
  auth_config?: Record<string, unknown>;
  request?: Record<string, unknown>;
  normalization?: Record<string, unknown>;
}) {
  return fetchJson<DerivedExternalSource>('/derived/sources', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateDerivedSource(sourceId: string, patch: Partial<{
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  base_url: string;
  auth_mode: DerivedAuthMode;
  auth_config: Record<string, unknown>;
  request: Record<string, unknown>;
  normalization: Record<string, unknown>;
}>) {
  return fetchJson<DerivedExternalSource>(`/derived/sources/${encodeURIComponent(sourceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteDerivedSource(sourceId: string) {
  return fetchJson<{ deleted: boolean; id: string }>(`/derived/sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}

export async function testDerivedSource(sourceId: string, input: { persist?: boolean; max_records?: number } = {}) {
  return fetchJson<DerivedSourceTestResponse>(`/derived/sources/${encodeURIComponent(sourceId)}/test`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listDerivedPipelines() {
  return fetchJson<DerivedListPipelinesResponse>('/derived/pipelines');
}

export async function listDerivedPipelineRuns(pipelineId: string, limit = 100) {
  return fetchJson<DerivedListPipelineRunsResponse>(`/derived/pipelines/${encodeURIComponent(pipelineId)}/runs?limit=${limit}`);
}

export async function listDerivedRuns(limit = 100) {
  return fetchJson<DerivedListPipelineRunsResponse>(`/derived/runs?limit=${limit}`);
}

export async function createDerivedPipeline(input: {
  name: string;
  slug?: string;
  description?: string;
  enabled?: boolean;
  realtime_enabled?: boolean;
  target_table: string;
  schedule?: Record<string, unknown>;
  spec: Record<string, unknown>;
}) {
  return fetchJson<DerivedPipeline>('/derived/pipelines', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function cloneDerivedPipeline(
  pipelineId: string,
  input: Partial<{
    name: string;
    slug: string;
    description: string;
    enabled: boolean;
    realtime_enabled: boolean;
    target_table: string;
  }> = {}
) {
  return fetchJson<DerivedPipeline>(`/derived/pipelines/${encodeURIComponent(pipelineId)}/clone`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateDerivedPipeline(pipelineId: string, patch: Partial<{
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  realtime_enabled: boolean;
  target_table: string;
  schedule: Record<string, unknown>;
  spec: Record<string, unknown>;
}>) {
  return fetchJson<DerivedPipeline>(`/derived/pipelines/${encodeURIComponent(pipelineId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteDerivedPipeline(pipelineId: string) {
  return fetchJson<{ deleted: boolean; id: string }>(`/derived/pipelines/${encodeURIComponent(pipelineId)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}

export async function runDerivedPipeline(
  pipelineId: string,
  input: { limit?: number; reconcile?: boolean; trigger_source?: string } = {}
) {
  return fetchJson<DerivedPipelineExecuteResponse>(`/derived/pipelines/${encodeURIComponent(pipelineId)}/run`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function runAllDerivedPipelines(
  input: { limit?: number; reconcile?: boolean; trigger_source?: string; include_disabled?: boolean } = {}
) {
  return fetchJson<DerivedPipelineRunAllResponse>('/derived/pipelines/run-all', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function previewDerivedPipeline(pipelineId: string, input: { limit?: number } = {}) {
  return fetchJson<DerivedPipelineExecuteResponse>(`/derived/pipelines/${encodeURIComponent(pipelineId)}/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getDerivedStatus() {
  return fetchJson<DerivedStatusResponse>('/derived/status');
}

export async function getFrontendCatalog() {
  return fetchJson<FrontendCatalogResponse>('/frontend/catalog');
}

export async function listFrontendVaults(input: { limit?: number; sort?: string } = {}) {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.sort) params.set('sort', String(input.sort));
  const query = params.toString();
  return fetchJson<FrontendVaultListResponse>(`/frontend/vaults${query ? `?${query}` : ''}`);
}

export async function getFrontendVaultOverview(vaultAddress: string) {
  return fetchJson<FrontendVaultOverview>(`/frontend/vaults/${encodeURIComponent(vaultAddress)}/overview`);
}

export async function getFrontendVaultPositions(vaultAddress: string, input: { limit?: number } = {}) {
  const query = input.limit !== undefined ? `?limit=${encodeURIComponent(String(input.limit))}` : '';
  return fetchJson<FrontendVaultPositionsResponse>(
    `/frontend/vaults/${encodeURIComponent(vaultAddress)}/positions${query}`
  );
}

export async function getFrontendVaultActions(vaultAddress: string, input: { days?: number; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (input.days !== undefined) params.set('days', String(input.days));
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  const query = params.toString();
  return fetchJson<FrontendVaultActionFeed>(
    `/frontend/vaults/${encodeURIComponent(vaultAddress)}/actions${query ? `?${query}` : ''}`
  );
}

export async function getFrontendVaultRisk(vaultAddress: string) {
  return fetchJson<FrontendVaultRiskSnapshot>(`/frontend/vaults/${encodeURIComponent(vaultAddress)}/risk`);
}

export async function bootstrapFrontendAgent() {
  return fetchJson<FrontendAgentBootstrapResponse>('/agents/frontend/bootstrap', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function createChatSession(input: {
  title?: string;
  metadata?: Record<string, unknown>;
  agent_id?: string;
  auto_execute?: boolean;
} = {}) {
  return fetchJson<AgentChatSessionRecord>('/agents/chat/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getChatSession(sessionId: string) {
  return fetchJson<AgentChatSessionRecord>(`/agents/chat/sessions/${encodeURIComponent(sessionId)}`);
}

export async function listChatMessages(sessionId: string, limit = 100) {
  return fetchJson<AgentChatMessagesResponse>(
    `/agents/chat/sessions/${encodeURIComponent(sessionId)}/messages?limit=${encodeURIComponent(String(limit))}`
  );
}

export async function sendChatMessage(
  sessionId: string,
  input: {
    message: string;
    intent?: string;
    tool_input?: Record<string, unknown>;
    confirm_token?: string;
    options?: AgentRequestOptions;
  }
) {
  return fetchJson<AgentChatTurnResponse>(`/agents/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: AGENT_CHAT_WRITE_TIMEOUT_MS,
  });
}

export async function runChatCompletion(input: {
  message: string;
  intent?: string;
  tool_input?: Record<string, unknown>;
  options?: AgentRequestOptions;
}) {
  return fetchJson<AgentChatCompletionsResponse>('/agents/chat/completions', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: AGENT_CHAT_WRITE_TIMEOUT_MS,
  });
}

export async function getAgentPlaygroundContext() {
  return fetchJson<AgentPlaygroundContextResponse>('/agents/playground/context');
}

export async function askAgentPlayground(question: string, options: AgentRequestOptions = {}) {
  return fetchJson<AgentAskResponse>('/agents/playground/ask', {
    method: 'POST',
    body: JSON.stringify({ question, options }),
    timeoutMs: AGENT_CHAT_WRITE_TIMEOUT_MS,
  });
}

export async function executeAgentPlan(plan: AgentPlan, options: AgentRequestOptions = {}) {
  return fetchJson<AgentExecuteResponse>('/agents/playground/execute', {
    method: 'POST',
    body: JSON.stringify({ plan, options }),
    timeoutMs: AGENT_CHAT_WRITE_TIMEOUT_MS,
  });
}

export async function getAgentTemplates() {
  return fetchJson<AgentTemplatesResponse>('/agents/templates');
}

export async function bootstrapBonzoClmmGuardAgent() {
  return fetchJson<BonzoBootstrapResponse>('/agents/bootstrap/bonzo-clmm-guard', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function listManagedAgents() {
  return fetchJson<ManagedAgentListResponse>('/agents');
}

export async function listManagedAgentTopics() {
  return fetchJson<ManagedAgentTopicsResponse>('/agents/topics');
}

export async function createManagedAgent(input: ManagedAgentCreateInput) {
  return fetchJson<ManagedAgentRecord>('/agents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getManagedAgent(agentId: string) {
  return fetchJson<ManagedAgentRecord>(`/agents/${encodeURIComponent(agentId)}`);
}

export async function updateManagedAgent(agentId: string, patch: ManagedAgentUpdateInput) {
  return fetchJson<ManagedAgentRecord>(`/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteManagedAgent(agentId: string) {
  return fetchJson<{ deleted: boolean; id: string }>(`/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}

export async function startManagedAgent(agentId: string) {
  return fetchJson<ManagedAgentRecord>(`/agents/${encodeURIComponent(agentId)}/start`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function stopManagedAgent(agentId: string) {
  return fetchJson<ManagedAgentRecord>(`/agents/${encodeURIComponent(agentId)}/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getManagedAgentActivity(agentId: string, limit = 100) {
  return fetchJson<ManagedAgentActivityResponse>(`/agents/${encodeURIComponent(agentId)}/activity?limit=${limit}`);
}

export async function getManagedAgentRuns(agentId: string, limit = 50) {
  return fetchJson<ManagedAgentRunsResponse>(`/agents/${encodeURIComponent(agentId)}/runs?limit=${limit}`);
}

export async function applyManagedAgentBrainstorm(agentId: string, payload: Record<string, unknown>) {
  return fetchJson<AgentBrainstormResponse>(`/agents/${encodeURIComponent(agentId)}/brainstorm`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runManagedAgentPublishTest(agentId: string, payload: Record<string, unknown>) {
  return fetchJson<AgentPublishTestResponse>(`/agents/${encodeURIComponent(agentId)}/publish/test`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function formatNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? new Intl.NumberFormat().format(parsed) : '0';
}

export function formatTime(value?: string | null) {
  if (!value) return '-';
  return value;
}
