import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SeFiDatabase } from '../src/database.js';
import { createConfig } from '../src/config.js';

function createTempPaths(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const manifestsDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  return {
    dbPath: path.join(tempDir, 'sefi.db'),
    cubeDbPath: path.join(tempDir, 'sefi.cube.db'),
    manifestsDir,
  };
}

test('agent control plane tables support CRUD + runs + events + topics', async () => {
  const { dbPath, cubeDbPath, manifestsDir } = createTempPaths('sefi-db-agents-');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestsDir,
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const created = database.createAgent({
    id: 'agent-001',
    name: 'Ops Reporter',
    type: 'hedera',
    network: 'testnet',
    model_provider: 'openai',
    model_name: 'gpt-5-mini',
    system_prompt: 'Report protocol health.',
    topics: ['ops', 'health'],
    post_examples: ['All systems nominal.'],
    semantic_scope: { allowed_cubes: ['stats'] },
    tool_allowlist: ['sefi.semantic.query', 'hedera.hcs.publish'],
    publish_targets: { hcs: { enabled: true } },
    schedule: { enabled: false, timezone: 'UTC' },
    env_refs: [{ key: 'hedera_account_id', env_var_name: 'SEFI_HEDERA_ACCOUNT_ID', required: true }],
    runtime_status: 'stopped',
    last_run_summary: null,
  });

  assert.equal(created.id, 'agent-001');
  assert.equal(created.tool_configs.length, 2);
  assert.equal(created.env_refs.length, 1);

  const updated = database.updateAgent('agent-001', {
    runtime_status: 'running',
    topics: ['ops', 'alerts'],
    schedule: { enabled: true, cron: '0 */6 * * *', timezone: 'UTC' },
    last_run_summary: { status: 'success', message: 'started' },
  });
  assert.equal(updated.runtime_status, 'running');
  assert.deepEqual(updated.topics, ['ops', 'alerts']);
  assert.equal(updated.schedules.length, 1);
  assert.equal(updated.schedules[0].enabled, true);

  database.createAgentRun({
    id: 'run-001',
    agent_id: 'agent-001',
    status: 'running',
    mode: 'manual',
    trigger_source: 'start',
    summary: 'Starting',
    details: null,
    started_at: new Date().toISOString(),
    finished_at: null,
  });
  database.createAgentEvent({
    agent_id: 'agent-001',
    run_id: 'run-001',
    event_type: 'runtime_start',
    level: 'info',
    message: 'Runtime started',
    payload: { status: 'ok' },
  });
  database.finishAgentRun('run-001', {
    status: 'success',
    summary: 'Runtime started',
    details: { status: 'ok' },
    finished_at: new Date().toISOString(),
  });

  const runs = database.getAgentRuns('agent-001', 10);
  const events = database.getAgentEvents('agent-001', 10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'success');
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'runtime_start');

  const registration = database.upsertAgentTopicRegistration({
    agent_id: 'agent-001',
    network: 'testnet',
    topic_id: '0.0.7001',
    label: 'Ops Topic',
  });
  assert.equal(registration.topic_id, '0.0.7001');
  assert.equal(database.getAllAgentTopicRegistrations().length, 1);

  const listed = database.listAgents();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].run_count, 1);
  assert.equal(listed[0].event_count, 1);
  assert.equal(listed[0].topic_registrations.length, 1);

  database.deleteAgent('agent-001');
  assert.equal(database.listAgents().length, 0);
  assert.equal(database.getAgentRuns('agent-001').length, 0);
  assert.equal(database.getAgentEvents('agent-001').length, 0);

  await database.close();
});

