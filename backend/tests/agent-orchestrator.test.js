import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config.js';
import { SeFiDatabase } from '../src/database.js';
import { AgentOrchestrator } from '../src/agent-orchestrator.js';

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

function createStubIndexer() {
  return {
    refreshManifests() {
      return null;
    },
  };
}

function createStubAgentService() {
  return {
    async ask(question) {
      return {
        request_id: 'req-1',
        plan: {
          mode: 'clarification',
          explanation: `Question received: ${question}`,
        },
        validation: {
          valid: true,
          errors: [],
          warnings: [],
        },
      };
    },
  };
}

test('orchestrator enforces testnet-only autonomous start policy', async () => {
  const { dbPath, cubeDbPath, manifestsDir } = createTempPaths('sefi-orch-policy-');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestsDir,
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const orchestrator = new AgentOrchestrator({
    config,
    database,
    indexer: createStubIndexer(),
    agentService: createStubAgentService(),
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) }),
  });

  const created = orchestrator.createAgent({
    id: 'agent-mainnet',
    name: 'Mainnet Agent',
    type: 'hedera',
    network: 'mainnet',
    env_refs: [
      { key: 'hedera_account_id', env_var_name: 'SEFI_HEDERA_ACCOUNT_ID', required: false },
      { key: 'hedera_private_key', env_var_name: 'SEFI_HEDERA_PRIVATE_KEY', required: false },
    ],
  });
  assert.equal(created.network, 'mainnet');

  await assert.rejects(
    () => orchestrator.startAgent(created.id),
    (error) => {
      assert.equal(error.code, 'AUTONOMOUS_NETWORK_BLOCKED');
      return true;
    }
  );

  await database.close();
});

test('orchestrator brainstorm and publish test update runtime telemetry', async () => {
  const { dbPath, cubeDbPath, manifestsDir } = createTempPaths('sefi-orch-publish-');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestsDir,
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const orchestrator = new AgentOrchestrator({
    config,
    database,
    indexer: createStubIndexer(),
    agentService: createStubAgentService(),
    fetchImpl: async () => {
      throw new Error('eliza unavailable');
    },
  });

  const created = orchestrator.createAgent({
    id: 'agent-eliza',
    name: 'Eliza Social Analyst',
    type: 'elizaos',
    network: 'testnet',
    env_refs: [
      { key: 'eliza_openai_api_key', env_var_name: 'OPENAI_API_KEY', required: false },
    ],
    publish_targets: {
      hcs: { enabled: false },
      twitter: { enabled: true },
    },
  });
  assert.equal(created.type, 'elizaos');

  const brainstorm = await orchestrator.applyBrainstorm(created.id, {
    template_key: 'social_analyst',
    idea: 'Summarize daily semantic trends',
    audience: 'Crypto traders',
    tone: 'Punchy and clear',
    required_metrics: ['stats.count'],
    sample_drafts: ['On-chain activity up 12% in 24h.'],
  });
  assert.equal(brainstorm.template.key, 'social_analyst');
  assert.match(brainstorm.agent.system_prompt, /Summarize daily semantic trends/);

  const publish = await orchestrator.publishTest(created.id, {
    question: 'How many records are indexed?',
    summary: 'Testing publish channel',
    voice_text: 'Momentum is rising.',
  });
  assert.equal(typeof publish.success, 'boolean');
  assert.equal(publish.structured_payload.agent_id, created.id);
  assert.equal(publish.channels.twitter.provider, 'eliza');

  const runs = orchestrator.getAgentRuns(created.id, 10);
  const events = orchestrator.getAgentActivity(created.id, 20);
  assert.ok(runs.length >= 1);
  assert.ok(events.length >= 1);

  await database.close();
});

