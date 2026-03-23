import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';

const cubeModelRoot = path.resolve(process.cwd(), '..', 'cube', 'model', 'cubes');

function readCubeModel(fileName) {
  return fs.readFileSync(path.join(cubeModelRoot, fileName), 'utf8');
}

function parseSingleCubeModel(fileName) {
  const content = readCubeModel(fileName);
  const parsed = YAML.parse(content);
  assert.equal(Array.isArray(parsed?.cubes), true, `${fileName} should include a cubes array`);
  assert.equal(parsed.cubes.length, 1, `${fileName} should define exactly one cube`);
  const cube = parsed.cubes[0];
  assert.equal(typeof cube?.name, 'string', `${fileName} cube must have a name`);
  return cube;
}

function assertQualifiedMember(member, expectedCube, allowedMembers, messagePrefix) {
  assert.equal(typeof member, 'string', `${messagePrefix} member must be a string`);
  const [cubeName, memberName, ...rest] = member.split('.');
  assert.equal(rest.length, 0, `${messagePrefix} member must be cube.member format: ${member}`);
  assert.equal(cubeName, expectedCube, `${messagePrefix} member must reference ${expectedCube}: ${member}`);
  assert.equal(allowedMembers.has(memberName), true, `${messagePrefix} member is not declared: ${member}`);
}

function assertQueryMembersMatchCube({ cubeName, cube, query }) {
  const dimensions = Array.isArray(cube?.dimensions) ? cube.dimensions : [];
  const measures = Array.isArray(cube?.measures) ? cube.measures : [];

  const dimensionNames = new Set(dimensions.map((item) => String(item?.name || '')).filter(Boolean));
  const measureNames = new Set(measures.map((item) => String(item?.name || '')).filter(Boolean));
  const allMemberNames = new Set([...dimensionNames, ...measureNames]);

  for (const dimension of query.dimensions || []) {
    assertQualifiedMember(dimension, cubeName, dimensionNames, `${cubeName}.dimensions`);
  }

  for (const measure of query.measures || []) {
    assertQualifiedMember(measure, cubeName, measureNames, `${cubeName}.measures`);
  }

  for (const timeDimension of query.timeDimensions || []) {
    assertQualifiedMember(timeDimension?.dimension, cubeName, dimensionNames, `${cubeName}.timeDimensions`);
  }

  for (const filter of query.filters || []) {
    assertQualifiedMember(filter?.member, cubeName, allMemberNames, `${cubeName}.filters`);
  }

  const order = query.order && typeof query.order === 'object' ? query.order : {};
  for (const member of Object.keys(order)) {
    assertQualifiedMember(member, cubeName, allMemberNames, `${cubeName}.order`);
  }
}

test('curated cube models expose corrected SeFi semantics', () => {
  const topicMessages = readCubeModel('topic_messages.yml');
  const contracts = readCubeModel('contracts.yml');
  const syncState = readCubeModel('sync_state.yml');
  const htsTransfers = readCubeModel('hts_transfers.yml');
  const contractLogs = readCubeModel('contract_logs.yml');

  assert.equal(fs.existsSync(path.join(cubeModelRoot, 'balances.yml')), false);
  assert.equal(fs.existsSync(path.join(cubeModelRoot, 'hbar_transfers.yml')), false);

  assert.match(topicMessages, /- name: message\s+sql: message_utf8/s);
  assert.match(topicMessages, /- name: message_base64\s+sql: message_base64/s);
  assert.match(topicMessages, /- name: payer_account_id\s+sql: payer_account_id/s);
  assert.match(topicMessages, /- name: consensus_timestamp[\s\S]*type: time/);
  assert.match(topicMessages, /- name: max_sequence_number[\s\S]*type: max/);

  assert.match(contracts, /- name: source_file\s+sql: source_file/s);
  assert.match(contracts, /- name: canonical_name\s+sql: canonical_name/s);
  assert.match(syncState, /- name: last_index\s+sql: last_index/s);
  assert.match(syncState, /- name: items_synced\s+sql: items_synced/s);
  assert.match(syncState, /- name: last_tx_id\s+sql: last_tx_id/s);
  assert.match(htsTransfers, /- name: account_id\s+sql: account_id/s);
  assert.match(htsTransfers, /- name: amount_signed\s+sql: amount_signed/s);
  assert.match(htsTransfers, /- name: is_approval\s+sql: is_approval/s);
  assert.match(contractLogs, /- name: timestamp[\s\S]*type: time/);
  assert.doesNotMatch(contractLogs, /- name: block_number[\s\S]*type: sum/);
});

test('CLMM and vault curated cube models are defined with expected table bindings', () => {
  const expected = [
    { fileName: 'clmm_pool_snapshots.yml', cubeName: 'clmm_pool_snapshots', sqlTable: 'main.clmm_pool_snapshots' },
    { fileName: 'clmm_positions.yml', cubeName: 'clmm_positions', sqlTable: 'main.clmm_positions' },
    { fileName: 'vault_strategy_state.yml', cubeName: 'vault_strategy_state', sqlTable: 'main.vault_strategy_state' },
    { fileName: 'vault_actions_decoded.yml', cubeName: 'vault_actions_decoded', sqlTable: 'main.vault_actions_decoded' },
    { fileName: 'price_volatility_snapshots.yml', cubeName: 'price_volatility_snapshots', sqlTable: 'main.price_volatility_snapshots' },
    { fileName: 'clmm_agent_state.yml', cubeName: 'clmm_agent_state', sqlTable: 'main.clmm_agent_state' },
  ];

  for (const spec of expected) {
    const cube = parseSingleCubeModel(spec.fileName);
    assert.equal(cube.name, spec.cubeName);
    assert.equal(cube.sql_table, spec.sqlTable);
    assert.equal(cube.data_source, 'default');
    const measureNames = new Set((cube.measures || []).map((item) => String(item?.name || '')).filter(Boolean));
    assert.equal(measureNames.has('count'), true, `${spec.fileName} should include count measure`);
  }
});

test('CLMM and vault cube test queries reference valid members', () => {
  const clmmPoolSnapshots = parseSingleCubeModel('clmm_pool_snapshots.yml');
  const clmmPositions = parseSingleCubeModel('clmm_positions.yml');
  const vaultStrategyState = parseSingleCubeModel('vault_strategy_state.yml');
  const vaultActionsDecoded = parseSingleCubeModel('vault_actions_decoded.yml');
  const priceVolatilitySnapshots = parseSingleCubeModel('price_volatility_snapshots.yml');
  const clmmAgentState = parseSingleCubeModel('clmm_agent_state.yml');

  assertQueryMembersMatchCube({
    cubeName: 'clmm_pool_snapshots',
    cube: clmmPoolSnapshots,
    query: {
      dimensions: [
        'clmm_pool_snapshots.pool_address',
        'clmm_pool_snapshots.dex_name',
        'clmm_pool_snapshots.token0_symbol',
        'clmm_pool_snapshots.token1_symbol',
        'clmm_pool_snapshots.current_tick',
        'clmm_pool_snapshots.spot_price',
        'clmm_pool_snapshots.tvl_usd',
      ],
      timeDimensions: [
        {
          dimension: 'clmm_pool_snapshots.snapshot_at',
          dateRange: 'Last 24 hours',
        },
      ],
      order: {
        'clmm_pool_snapshots.snapshot_at': 'desc',
      },
      limit: 10,
    },
  });

  assertQueryMembersMatchCube({
    cubeName: 'clmm_positions',
    cube: clmmPositions,
    query: {
      measures: ['clmm_positions.active_positions', 'clmm_positions.total_liquidity'],
      dimensions: [
        'clmm_positions.vault_address',
        'clmm_positions.pool_address',
        'clmm_positions.position_id',
        'clmm_positions.tick_lower',
        'clmm_positions.tick_upper',
        'clmm_positions.range_width',
      ],
      filters: [
        {
          member: 'clmm_positions.is_active',
          operator: 'equals',
          values: ['true'],
        },
      ],
      order: {
        'clmm_positions.last_updated_at': 'desc',
      },
      limit: 20,
    },
  });

  assertQueryMembersMatchCube({
    cubeName: 'vault_strategy_state',
    cube: vaultStrategyState,
    query: {
      dimensions: [
        'vault_strategy_state.vault_name',
        'vault_strategy_state.vault_address',
        'vault_strategy_state.asset_pair',
        'vault_strategy_state.current_tick',
        'vault_strategy_state.active_lower_tick',
        'vault_strategy_state.active_upper_tick',
        'vault_strategy_state.in_range',
        'vault_strategy_state.idle_ratio',
        'vault_strategy_state.deployed_ratio',
        'vault_strategy_state.tvl_usd',
      ],
      order: {
        'vault_strategy_state.state_at': 'desc',
      },
      limit: 25,
    },
  });

  assertQueryMembersMatchCube({
    cubeName: 'vault_actions_decoded',
    cube: vaultActionsDecoded,
    query: {
      measures: [
        'vault_actions_decoded.count',
        'vault_actions_decoded.unique_tx_count',
        'vault_actions_decoded.total_value_usd',
      ],
      dimensions: ['vault_actions_decoded.vault_address', 'vault_actions_decoded.action_type'],
      timeDimensions: [
        {
          dimension: 'vault_actions_decoded.action_at',
          dateRange: 'Last 7 days',
          granularity: 'day',
        },
      ],
      order: {
        'vault_actions_decoded.action_at': 'desc',
      },
      limit: 100,
    },
  });

  assertQueryMembersMatchCube({
    cubeName: 'price_volatility_snapshots',
    cube: priceVolatilitySnapshots,
    query: {
      dimensions: [
        'price_volatility_snapshots.market_key',
        'price_volatility_snapshots.base_symbol',
        'price_volatility_snapshots.quote_symbol',
        'price_volatility_snapshots.price',
        'price_volatility_snapshots.realized_vol_1h',
        'price_volatility_snapshots.realized_vol_6h',
        'price_volatility_snapshots.realized_vol_24h',
      ],
      timeDimensions: [
        {
          dimension: 'price_volatility_snapshots.snapshot_at',
          dateRange: 'Last 48 hours',
        },
      ],
      order: {
        'price_volatility_snapshots.snapshot_at': 'desc',
      },
      limit: 50,
    },
  });

  assertQueryMembersMatchCube({
    cubeName: 'clmm_agent_state',
    cube: clmmAgentState,
    query: {
      dimensions: [
        'clmm_agent_state.vault_name',
        'clmm_agent_state.asset_pair',
        'clmm_agent_state.in_range',
        'clmm_agent_state.nearest_boundary_distance',
        'clmm_agent_state.realized_vol_6h',
        'clmm_agent_state.risk_regime',
        'clmm_agent_state.suggested_action',
        'clmm_agent_state.confidence_score',
        'clmm_agent_state.reason_summary',
      ],
      filters: [
        {
          member: 'clmm_agent_state.suggested_action',
          operator: 'notEquals',
          values: ['hold'],
        },
      ],
      order: {
        'clmm_agent_state.state_at': 'desc',
      },
      limit: 25,
    },
  });
});
