import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config.js';
import { SeFiDatabase } from '../src/database.js';
import {
  DerivedPipelineService,
  normalizeBonzoMarketPayload,
  validateDerivedPipelineDefinition,
  validateExternalSourceDefinition,
} from '../src/derived.js';

function createTempConfig(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const manifestsDir = path.join(root, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });

  return {
    root,
    config: createConfig({
      SEFI_DB_PATH: path.join(root, 'sefi.db'),
      SEFI_CUBE_DB_PATH: path.join(root, 'sefi.cube.db'),
      SEFI_MANIFESTS_DIR: manifestsDir,
      SEFI_DERIVED_ENABLED: 'true',
      SEFI_DERIVED_BATCH_SIZE: '1000',
      SEFI_DERIVED_RECONCILE_CRON: '0 2 * * *',
      SEFI_BONZO_API_BASE_URL: 'https://data.bonzo.finance/',
      SEFI_EXTERNAL_SOURCE_TIMEOUT_MS: '1000',
      SEFI_EXTERNAL_SOURCE_MAX_RETRIES: '0',
    }),
  };
}

function encodeWord(value) {
  return value.toString(16).padStart(64, '0');
}

test('derived validators normalize source and pipeline inputs', () => {
  const sourceValidation = validateExternalSourceDefinition(
    {
      name: 'Bonzo Market Feed',
      base_url: 'https://data.bonzo.finance',
      auth_mode: 'none',
      request: {
        path: '/market',
      },
      normalization: {
        records_path: 'reserves',
      },
    },
    { partial: false }
  );

  assert.deepEqual(sourceValidation.errors, []);
  assert.equal(sourceValidation.value.slug, 'bonzo-market-feed');
  assert.equal(sourceValidation.value.base_url, 'https://data.bonzo.finance/');

  const pipelineValidation = validateDerivedPipelineDefinition(
    {
      name: 'My Derived Table',
      target_table: 'my_derived_table',
      spec: {
        kind: 'sql_transform',
        source_sql: 'SELECT id FROM contract_logs WHERE id > {{cursor}} LIMIT {{limit}}',
        cursor_column: 'id',
        key_columns: ['id'],
      },
    },
    { partial: false }
  );

  assert.deepEqual(pipelineValidation.errors, []);
  assert.equal(pipelineValidation.value.slug, 'my-derived-table');
  assert.equal(pipelineValidation.value.spec.kind, 'sql_transform');
});

test('normalizeBonzoMarketPayload extracts reserve price records', () => {
  const payload = normalizeBonzoMarketPayload({
    timestamp: '2026-03-23T10:15:00Z',
    reserves: [
      {
        symbol: 'USDC',
        evm_address: '0x1111111111111111111111111111111111111111',
        hts_address: '0.0.1001',
        price_usd_display: '1.00',
      },
    ],
  });

  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].normalized.symbol, 'USDC');
  assert.equal(payload.records[0].normalized.price_usd, 1);
});

test('custom source enrichment maps external API records into sql_transform pipelines', async () => {
  const { config } = createTempConfig('sefi-derived-enrichment-');
  const database = new SeFiDatabase(config);
  await database.init();

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        data: [
          {
            token: {
              evm: '0x1111111111111111111111111111111111111111',
            },
            symbol: 'USDC',
            price: {
              usd: '1.01',
            },
          },
        ],
      };
    },
    async text() {
      return 'ok';
    },
  });

  const derived = new DerivedPipelineService({
    config,
    database,
    fetchImpl,
  });
  await derived.init();

  const customSource = derived.createSource({
    name: 'Custom Price Feed',
    slug: 'custom-price-feed',
    base_url: 'https://prices.example.com/',
    auth_mode: 'none',
    request: {
      path: '/prices',
      method: 'GET',
      params: {},
      headers: {},
    },
    normalization: {
      records_path: 'data',
      key_field: 'token.evm',
      fields: {
        evm_address: 'token.evm',
        symbol: 'symbol',
        price_usd_display: 'price.usd',
      },
    },
  });

  await derived.runSource(customSource.id, {
    triggerSource: 'test',
    persist: true,
    maxRecords: 50,
  });

  database.runStatement(`
    CREATE TABLE IF NOT EXISTS enrichment_input (
      id INTEGER PRIMARY KEY,
      token_address TEXT NOT NULL
    )
  `);
  database.runStatement(
    `INSERT INTO enrichment_input (id, token_address) VALUES (?, ?)`,
    [1, '0x1111111111111111111111111111111111111111']
  );

  const pipeline = derived.createPipeline({
    name: 'Enrichment Test Pipeline',
    slug: 'enrichment-test-pipeline',
    target_table: 'enrichment_output',
    enabled: true,
    realtime_enabled: false,
    schedule: { mode: 'manual' },
    spec: {
      kind: 'sql_transform',
      source_sql: 'SELECT id, lower(token_address) AS token_address FROM enrichment_input WHERE id > {{cursor}} ORDER BY id ASC LIMIT {{limit}}',
      cursor_column: 'id',
      key_columns: ['id'],
      target_columns: [
        { name: 'id', type: 'INTEGER', primary_key: true },
        { name: 'token_address', type: 'TEXT' },
        { name: 'symbol', type: 'TEXT' },
        { name: 'usd_price', type: 'REAL' },
      ],
      column_mappings: {
        id: '$id',
        token_address: '$token_address',
      },
      enrichment: [
        {
          source_slug: 'custom-price-feed',
          local_field: 'token_address',
          remote_field: 'evm_address',
          assignments: {
            symbol: 'symbol',
            usd_price: 'price_usd_display',
          },
        },
      ],
    },
  });

  await derived.runPipelineById(pipeline.id, {
    triggerSource: 'test',
    limit: 500,
  });

  const enriched = database.queryOne(`SELECT * FROM enrichment_output WHERE id = ? LIMIT 1`, [1]);
  assert.equal(enriched?.symbol, 'USDC');
  assert.equal(Number(enriched?.usd_price || 0), 1.01);

  derived.close();
  await database.close();
});

test('derived service seeds built-ins and materializes CLMM/vault rows', async () => {
  const { config } = createTempConfig('sefi-derived-');
  const database = new SeFiDatabase(config);
  await database.init();

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        timestamp: '2026-03-23T10:15:00Z',
        reserves: [
          {
            symbol: 'USDC',
            evm_address: '0x1111111111111111111111111111111111111111',
            hts_address: '0.0.1001',
            price_usd_display: '1.00',
          },
          {
            symbol: 'HBAR',
            evm_address: '0x2222222222222222222222222222222222222222',
            hts_address: '0.0.1002',
            price_usd_display: '0.09',
          },
        ],
      };
    },
    async text() {
      return 'ok';
    },
  });

  const derived = new DerivedPipelineService({
    config,
    database,
    fetchImpl,
  });
  await derived.init();

  const sources = derived.listSources();
  assert.ok(sources.some((source) => source.slug === 'bonzo-market'));

  const source = sources.find((entry) => entry.slug === 'bonzo-market');
  const sourceRun = await derived.runSource(source.id, {
    triggerSource: 'test',
    persist: true,
    maxRecords: 100,
  });
  assert.equal(sourceRun.records_fetched >= 2, true);

  const requiredTables = [
    'external_sources',
    'external_source_runs',
    'external_source_records',
    'derived_pipelines',
    'derived_pipeline_runs',
    'derived_pipeline_cursors',
    'derived_pipeline_contract_cursors',
    'clmm_pool_snapshots',
    'clmm_positions',
    'vault_strategy_state',
    'vault_actions_decoded',
    'price_volatility_snapshots',
    'clmm_agent_state',
  ];

  for (const tableName of requiredTables) {
    const row = database.queryOne(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`, [tableName]);
    assert.equal(row?.name, tableName);
  }

  database.registerContract({
    id: 'testnet:0.0.9001',
    name: 'CLMM Pool One',
    canonicalName: 'CLMM Pool One',
    category: 'clmm_pool',
    evm: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    asset: 'USDC/HBAR',
    sourceFile: 'manifest.json',
  });
  database.registerContract({
    id: 'testnet:0.0.9002',
    name: 'Vault One',
    canonicalName: 'Vault One',
    category: 'vault-single-vault',
    evm: '0xcccccccccccccccccccccccccccccccccccccccc',
    asset: 'USDC/HBAR',
    sourceFile: 'manifest.json',
  });
  database.registerContract({
    id: 'testnet:0.0.9003',
    name: 'Strategy One',
    canonicalName: 'Strategy One',
    category: 'vault-single-strategy',
    evm: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    asset: 'USDC/HBAR',
    sourceFile: 'manifest.json',
  });

  database.insertContractLogs([
    {
      contract_id: 'testnet:0.0.9001',
      tx_hash: '0xabc123',
      event_name: 'Swap',
      topic0: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
      topic1: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      topic2: '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
      topic3: '0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd',
      data: `0x${[
        1n,
        2n,
        79228162514264337593543950336n,
        1000n,
        10n,
      ].map(encodeWord).join('')}`,
      block_number: 100,
      log_index: 1,
      timestamp: '1700000000.000000001',
    },
    {
      contract_id: 'testnet:0.0.9001',
      tx_hash: '0xabc124',
      event_name: 'Mint',
      topic0: '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
      topic1: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      topic2: '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
      topic3: null,
      data: `0x${[
        1n,
        20n,
        1000n,
        11n,
        12n,
      ].map(encodeWord).join('')}`,
      block_number: 101,
      log_index: 2,
      timestamp: '1700000001.000000001',
    },
    {
      contract_id: 'testnet:0.0.9001',
      tx_hash: '0xabc125',
      event_name: 'Unknown',
      topic0: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      topic1: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      topic2: '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
      topic3: null,
      data: `0x${[5n, 6n, 7n].map(encodeWord).join('')}`,
      block_number: 102,
      log_index: 3,
      timestamp: '1700000002.000000001',
    },
    {
      contract_id: 'testnet:0.0.9003',
      tx_hash: '0xabc126',
      event_name: 'Mint',
      topic0: '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
      topic1: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      topic2: '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
      topic3: null,
      data: `0x${[
        4n,
        40n,
        2000n,
        15n,
        18n,
      ].map(encodeWord).join('')}`,
      block_number: 103,
      log_index: 4,
      timestamp: '1700000003.000000001',
    },
    {
      contract_id: 'testnet:0.0.9003',
      tx_hash: '0xabc127',
      event_name: 'Unknown',
      topic0: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      topic1: '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      topic2: '0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd',
      topic3: null,
      data: `0x${[9n, 10n, 11n].map(encodeWord).join('')}`,
      block_number: 104,
      log_index: 5,
      timestamp: '1700000004.000000001',
    },
  ]);

  const pipelines = derived.listPipelines();
  assert.equal(pipelines.filter((pipeline) => pipeline.is_system).length >= 6, true);

  const poolSnapshotsPipeline = pipelines.find((pipeline) => pipeline.preset_key === 'clmm_pool_snapshots');
  const positionsPipeline = pipelines.find((pipeline) => pipeline.preset_key === 'clmm_positions');
  const actionsPipeline = pipelines.find((pipeline) => pipeline.preset_key === 'vault_actions_decoded');
  const statePipeline = pipelines.find((pipeline) => pipeline.preset_key === 'vault_strategy_state');
  const volatilityPipeline = pipelines.find((pipeline) => pipeline.preset_key === 'price_volatility_snapshots');
  const agentStatePipeline = pipelines.find((pipeline) => pipeline.preset_key === 'clmm_agent_state');

  await derived.runPipelineById(poolSnapshotsPipeline.id, { triggerSource: 'test' });
  await derived.runPipelineById(positionsPipeline.id, { triggerSource: 'test' });
  await derived.runPipelineById(actionsPipeline.id, { triggerSource: 'test' });
  await derived.runPipelineById(statePipeline.id, { triggerSource: 'test' });
  await derived.runPipelineById(volatilityPipeline.id, { triggerSource: 'test' });
  await derived.runPipelineById(agentStatePipeline.id, { triggerSource: 'test' });

  const poolSnapshotCount = database.queryOne('SELECT COUNT(*) AS count FROM clmm_pool_snapshots')?.count || 0;
  const positionCount = database.queryOne('SELECT COUNT(*) AS count FROM clmm_positions')?.count || 0;
  const actionCount = database.queryOne('SELECT COUNT(*) AS count FROM vault_actions_decoded')?.count || 0;
  const volatilityCount = database.queryOne('SELECT COUNT(*) AS count FROM price_volatility_snapshots')?.count || 0;

  assert.equal(poolSnapshotCount >= 1, true);
  assert.equal(positionCount >= 1, true);
  assert.equal(actionCount >= 1, true);
  assert.equal(volatilityCount >= 1, true);

  const mappedVaultAction = database.queryOne(
    `SELECT vault_address, action_type
       FROM vault_actions_decoded
      WHERE tx_hash = ?
      LIMIT 1`,
    ['0xabc127']
  );
  assert.equal(mappedVaultAction?.vault_address, '0xcccccccccccccccccccccccccccccccccccccccc');
  assert.equal(
    mappedVaultAction?.action_type,
    'topic0:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  );

  const derivedVaultState = database.queryOne(
    `SELECT vault_name FROM vault_strategy_state WHERE vault_address = ? LIMIT 1`,
    ['0xcccccccccccccccccccccccccccccccccccccccc']
  );
  assert.equal(derivedVaultState?.vault_name, 'Vault One');

  const unknownAction = database.queryOne(
    `SELECT action_type
       FROM vault_actions_decoded
      WHERE action_type = 'topic0:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      LIMIT 1`
  );
  assert.equal(
    unknownAction?.action_type,
    'topic0:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  );

  // Idempotent resume behavior: second run with no new logs should not duplicate rows.
  await derived.runPipelineById(poolSnapshotsPipeline.id, { triggerSource: 'test' });
  const poolSnapshotCountAfterResume = database.queryOne('SELECT COUNT(*) AS count FROM clmm_pool_snapshots')?.count || 0;
  assert.equal(poolSnapshotCountAfterResume, poolSnapshotCount);

  // Reconcile behavior: mapping changes should refresh trailing window rows in place.
  database.runStatement(`UPDATE contracts SET asset = ? WHERE contract_id = ?`, [
    'USDC/USDT',
    'testnet:0.0.9001',
  ]);
  await derived.runPipelineById(poolSnapshotsPipeline.id, {
    triggerSource: 'reconcile-test',
    reconcile: true,
    limit: 5000,
  });

  const reconciledSnapshot = database.queryOne(
    `SELECT token0_symbol, token1_symbol
       FROM clmm_pool_snapshots
      WHERE snapshot_id = ?
      LIMIT 1`,
    ['testnet:0.0.9001:1']
  );
  assert.equal(reconciledSnapshot?.token0_symbol, 'USDC');
  assert.equal(reconciledSnapshot?.token1_symbol, 'USDT');

  // System pipelines can be cloned into editable custom copies.
  const clonedPipeline = derived.clonePipeline(poolSnapshotsPipeline.id, {
    name: 'CLMM Pool Snapshots Custom',
    target_table: 'clmm_pool_snapshots_custom',
    enabled: true,
  });

  assert.equal(clonedPipeline.is_system, false);
  assert.equal(clonedPipeline.target_table, 'clmm_pool_snapshots_custom');
  assert.equal(clonedPipeline.spec?.kind, 'builtin');

  await derived.runPipelineById(clonedPipeline.id, { triggerSource: 'test' });
  const clonedTableCount = database.queryOne('SELECT COUNT(*) AS count FROM clmm_pool_snapshots_custom')?.count || 0;
  assert.equal(clonedTableCount >= 1, true);

  const runAllSummary = await derived.runAllPipelines({
    triggerSource: 'test-run-all',
    limit: 5000,
  });
  assert.equal(runAllSummary.total >= 7, true);
  assert.equal(runAllSummary.failed_count, 0);
  assert.equal(runAllSummary.success_count, runAllSummary.total);

  derived.close();
  await database.close();
});

test('vault action resolver skips unresolved actions and logs ingest_errors', async () => {
  const { config } = createTempConfig('sefi-derived-vault-resolver-');
  const database = new SeFiDatabase(config);
  await database.init();

  const derived = new DerivedPipelineService({
    config,
    database,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { reserves: [], timestamp: '2026-03-23T10:15:00Z' };
      },
      async text() {
        return 'ok';
      },
    }),
  });
  await derived.init();

  database.registerContract({
    id: 'testnet:0.0.9201',
    name: 'Orphan Strategy',
    canonicalName: 'Orphan Strategy',
    category: 'vault-single-strategy',
    evm: '0xabababababababababababababababababababab',
    asset: 'USDC/HBAR',
    sourceFile: 'manifest.json',
  });

  database.insertContractLogs([
    {
      contract_id: 'testnet:0.0.9201',
      tx_hash: '0xunresolved1',
      event_name: 'Unknown',
      topic0: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      topic1: '0x0000000000000000000000001111111111111111111111111111111111111111',
      topic2: '0x0000000000000000000000002222222222222222222222222222222222222222',
      topic3: null,
      data: `0x${[1n, 2n, 3n].map(encodeWord).join('')}`,
      block_number: 300,
      log_index: 1,
      timestamp: '1700000200.000000001',
    },
  ]);

  const pipeline = derived.listPipelines().find((entry) => entry.preset_key === 'vault_actions_decoded');
  const execution = await derived.runPipelineById(pipeline.id, { triggerSource: 'test' });
  assert.equal(Number(execution.run?.rows_written || 0), 0);

  const actionCount = database.queryOne(`SELECT COUNT(*) AS count FROM vault_actions_decoded`)?.count || 0;
  assert.equal(actionCount, 0);

  const unresolved = database.queryOne(
    `SELECT COUNT(*) AS count
       FROM ingest_errors
      WHERE entity_type = 'vault_action_unresolved'`
  )?.count || 0;
  assert.equal(unresolved, 1);

  derived.close();
  await database.close();
});

test('per-contract derived cursors prevent long-tail starvation on skewed logs', async () => {
  const { config } = createTempConfig('sefi-derived-fairness-');
  const database = new SeFiDatabase(config);
  await database.init();

  const derived = new DerivedPipelineService({
    config: {
      ...config,
      derivedBatchSize: 4,
    },
    database,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          reserves: [
            { symbol: 'USDC', price_usd_display: '1.0', evm_address: '0x1111111111111111111111111111111111111111' },
            { symbol: 'HBAR', price_usd_display: '0.09', evm_address: '0x2222222222222222222222222222222222222222' },
          ],
          timestamp: '2026-03-23T10:15:00Z',
        };
      },
      async text() {
        return 'ok';
      },
    }),
  });
  await derived.init();

  database.registerContract({
    id: 'testnet:0.0.9301',
    name: 'High Volume Pool',
    canonicalName: 'High Volume Pool',
    category: 'vault-dual-pool',
    evm: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    asset: 'USDC/HBAR',
    sourceFile: 'manifest.json',
  });
  database.registerContract({
    id: 'testnet:0.0.9302',
    name: 'Low Volume Pool',
    canonicalName: 'Low Volume Pool',
    category: 'vault-single-pool',
    evm: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    asset: 'USDC/HBAR',
    sourceFile: 'manifest.json',
  });

  const makeSwapLog = (contractId, txHash, logIndex, timestamp) => ({
    contract_id: contractId,
    tx_hash: txHash,
    event_name: 'Swap',
    topic0: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
    topic1: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    topic2: '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
    topic3: null,
    data: `0x${[1n, 2n, 79228162514264337593543950336n, 1000n, 10n].map(encodeWord).join('')}`,
    block_number: 500 + logIndex,
    log_index: logIndex,
    timestamp,
  });

  const skewedLogs = [];
  for (let i = 0; i < 12; i += 1) {
    skewedLogs.push(makeSwapLog('testnet:0.0.9301', `0xhigh${i}`, i + 1, `17000003${String(i).padStart(2, '0')}.000000001`));
  }
  skewedLogs.push(makeSwapLog('testnet:0.0.9302', '0xlow0', 200, '1700000400.000000001'));
  database.insertContractLogs(skewedLogs);

  const pipeline = derived.listPipelines().find((entry) => entry.preset_key === 'clmm_pool_snapshots');
  await derived.runPipelineById(pipeline.id, {
    triggerSource: 'test',
    limit: 4,
  });

  const lowPoolRows = database.queryOne(
    `SELECT COUNT(*) AS count FROM clmm_pool_snapshots WHERE snapshot_id LIKE 'testnet:0.0.9302:%'`
  )?.count || 0;
  assert.equal(lowPoolRows >= 1, true);

  const cursorRows = database.queryAll(
    `SELECT contract_id, cursor_log_id
       FROM derived_pipeline_contract_cursors
      WHERE pipeline_id = ?`,
    [pipeline.id]
  );
  assert.equal(cursorRows.length >= 2, true);
  const lowCursor = cursorRows.find((row) => row.contract_id === 'testnet:0.0.9302');
  assert.equal(Number(lowCursor?.cursor_log_id || 0) > 0, true);

  derived.close();
  await database.close();
});

test('rebuildDerivedPipelines is idempotent and resets both cursor layers', async () => {
  const { config } = createTempConfig('sefi-derived-rebuild-');
  const database = new SeFiDatabase(config);
  await database.init();

  const derived = new DerivedPipelineService({
    config,
    database,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          reserves: [
            { symbol: 'USDC', price_usd_display: '1.0', evm_address: '0x1111111111111111111111111111111111111111' },
            { symbol: 'HBAR', price_usd_display: '0.09', evm_address: '0x2222222222222222222222222222222222222222' },
          ],
          timestamp: '2026-03-23T10:15:00Z',
        };
      },
      async text() {
        return 'ok';
      },
    }),
  });
  await derived.init();

  database.registerContract({
    id: 'testnet:0.0.9401',
    name: 'Rebuild Pool',
    canonicalName: 'Rebuild Pool',
    category: 'vault-dual-pool',
    evm: '0xdddddddddddddddddddddddddddddddddddddddd',
    asset: 'USDC/HBAR',
    sourceFile: 'manifest.json',
  });

  database.insertContractLogs([
    {
      contract_id: 'testnet:0.0.9401',
      tx_hash: '0xreb1',
      event_name: 'Swap',
      topic0: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
      topic1: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      topic2: '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
      topic3: null,
      data: `0x${[1n, 2n, 79228162514264337593543950336n, 1000n, 10n].map(encodeWord).join('')}`,
      block_number: 700,
      log_index: 1,
      timestamp: '1700000500.000000001',
    },
  ]);

  const first = await derived.rebuildDerivedPipelines({
    pipelines: ['clmm_pool_snapshots'],
    limit: 100,
    max_passes: 20,
    reconcile: false,
  });
  assert.equal(first.failed_runs, 0);

  const firstCount = database.queryOne(`SELECT COUNT(*) AS count FROM clmm_pool_snapshots`)?.count || 0;
  assert.equal(firstCount >= 1, true);

  const second = await derived.rebuildDerivedPipelines({
    pipelines: ['clmm_pool_snapshots'],
    limit: 100,
    max_passes: 20,
    reconcile: false,
  });
  assert.equal(second.failed_runs, 0);
  const secondCount = database.queryOne(`SELECT COUNT(*) AS count FROM clmm_pool_snapshots`)?.count || 0;
  assert.equal(secondCount, firstCount);

  const cursorRows = database.queryAll(
    `SELECT cursor_log_id FROM derived_pipeline_contract_cursors
      WHERE pipeline_id = (
        SELECT id FROM derived_pipelines WHERE preset_key = 'clmm_pool_snapshots' LIMIT 1
      )`
  );
  assert.equal(cursorRows.length >= 1, true);
  assert.equal(cursorRows.some((row) => Number(row.cursor_log_id || 0) > 0), true);

  derived.close();
  await database.close();
});
