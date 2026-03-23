import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SeFiDatabase } from '../src/database.js';

function createTempConfig(rootDir) {
  return {
    dbPath: path.join(rootDir, 'data', 'sefi.db'),
    cubeDbPath: path.join(rootDir, 'data', 'sefi.cube.db'),
    maxDbSizeBytes: 1024 * 1024 * 1024,
    cubeModelDir: path.join(rootDir, 'cube', 'model'),
  };
}

test('database persists API endpoint definitions and model AI drafts', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-api-modeling-'));
  const config = createTempConfig(rootDir);

  const db = new SeFiDatabase(config);
  await db.init();

  const createdEndpoint = db.createApiEndpoint({
    name: 'Top Contracts',
    slug: 'top-contracts',
    description: 'Top contracts from cube',
    enabled: true,
    query_template: {
      measures: ['contract_logs.count'],
      limit: '{{limit}}',
    },
    params_schema: [
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: 25,
      },
    ],
  });

  assert.equal(createdEndpoint.slug, 'top-contracts');
  assert.equal(createdEndpoint.enabled, true);

  const listed = db.listApiEndpoints();
  assert.equal(listed.length, 1);

  const updated = db.updateApiEndpoint(createdEndpoint.id, {
    name: 'Top Contracts v2',
    enabled: false,
  });
  assert.equal(updated.name, 'Top Contracts v2');
  assert.equal(updated.enabled, false);

  db.recordApiEndpointRun(createdEndpoint.id, 'success', null);
  const afterRun = db.getApiEndpointById(createdEndpoint.id);
  assert.equal(afterRun.last_run_status, 'success');

  const draft = db.createAiModelDraft({
    intent_text: 'build a contracts cube',
    constraints_text: 'keep dimensions simple',
    target_path: 'generated/cubes/contracts_ai.yml',
    generated_yaml: 'cubes:\n  - name: gen_contracts\n    sql_table: main.contracts\n',
    rationale: 'maps contracts table',
    warnings: [],
    validation: { valid: true, errors: [] },
    context_hash: 'hash123',
    llm_model: 'gpt-5',
  });

  assert.equal(draft.status, 'draft');
  assert.equal(draft.target_path, 'generated/cubes/contracts_ai.yml');

  const approved = db.approveAiModelDraft(draft.draft_id, 'generated/cubes/contracts_ai.yml');
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved_path, 'generated/cubes/contracts_ai.yml');

  db.deleteApiEndpoint(createdEndpoint.id);
  assert.equal(db.listApiEndpoints().length, 0);

  await db.close();
});
