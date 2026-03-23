import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SeFiDatabase } from '../src/database.js';
import { ModelingService } from '../src/modeling.js';

function createTempConfig(rootDir) {
  return {
    dbPath: path.join(rootDir, 'data', 'sefi.db'),
    cubeDbPath: path.join(rootDir, 'data', 'sefi.cube.db'),
    maxDbSizeBytes: 1024 * 1024 * 1024,
    cubeModelDir: path.join(rootDir, 'cube', 'model'),
  };
}

test('schema preview is deterministic for the same sqlite state', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-preview-'));
  const config = createTempConfig(rootDir);

  const db = new SeFiDatabase(config);
  await db.init();
  db.runStatement('CREATE TABLE IF NOT EXISTS custom_events (id INTEGER PRIMARY KEY, account_id TEXT, amount REAL, created_at TEXT)');

  const service = new ModelingService({ config, database: db });
  const firstPreview = service.buildPreview();
  const secondPreview = service.buildPreview();

  assert.equal(firstPreview.preview_id, secondPreview.preview_id);
  assert.equal(firstPreview.files.length, secondPreview.files.length);
  assert.ok(firstPreview.files.length > 0);

  await db.close();
});

test('schema apply writes generated files and remains idempotent', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-apply-'));
  const config = createTempConfig(rootDir);

  const curatedDir = path.join(config.cubeModelDir, 'cubes');
  fs.mkdirSync(curatedDir, { recursive: true });
  const curatedFile = path.join(curatedDir, 'contracts.yml');
  fs.writeFileSync(curatedFile, 'cubes:\n  - name: contracts\n', 'utf8');

  const db = new SeFiDatabase(config);
  await db.init();
  db.runStatement('CREATE TABLE IF NOT EXISTS alpha_table (id INTEGER PRIMARY KEY, value TEXT)');

  const service = new ModelingService({ config, database: db });
  const preview = service.buildPreview();
  const firstApply = service.applyPreview(preview.preview_id);

  assert.ok(firstApply.writes_applied > 0);
  assert.equal(fs.readFileSync(curatedFile, 'utf8'), 'cubes:\n  - name: contracts\n');

  const secondPreview = service.buildPreview();
  const secondApply = service.applyPreview(secondPreview.preview_id);
  assert.equal(secondApply.writes_applied, 0);
  assert.equal(secondApply.removals_applied, 0);

  await db.close();
});

test('schema apply rejects stale preview ids', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-stale-'));
  const config = createTempConfig(rootDir);

  const db = new SeFiDatabase(config);
  await db.init();

  const service = new ModelingService({ config, database: db });
  const preview = service.buildPreview();

  db.runStatement('CREATE TABLE IF NOT EXISTS stale_table (id INTEGER PRIMARY KEY, updated_at TEXT)');

  assert.throws(() => service.applyPreview(preview.preview_id), (error) => {
    assert.equal(error.code, 'STALE_PREVIEW');
    return true;
  });

  await db.close();
});

test('model file CRUD supports create, edit, read, and delete', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-crud-'));
  const config = createTempConfig(rootDir);

  const db = new SeFiDatabase(config);
  await db.init();

  const service = new ModelingService({ config, database: db });
  const modelPath = 'generated/cubes/custom.yml';
  const firstContent = 'cubes:\n  - name: gen_custom\n';
  const secondContent = 'cubes:\n  - name: gen_custom\n    sql_table: main.contracts\n';

  const created = service.upsertModelFile(modelPath, firstContent);
  assert.equal(created.created, true);
  assert.equal(fs.existsSync(created.file_path), true);

  const loaded = service.getModelFileContent(modelPath);
  assert.equal(loaded.content, firstContent);

  const updated = service.upsertModelFile(modelPath, secondContent);
  assert.equal(updated.created, false);

  const listed = service.listModelFiles('generated');
  assert.equal(listed.count, 1);
  assert.equal(listed.files[0].path, modelPath);

  const deleted = service.deleteModelFile(modelPath);
  assert.equal(deleted.deleted, true);
  assert.equal(fs.existsSync(deleted.file_path), false);

  await db.close();
});

test('model file operations reject unsafe paths and non-yaml extensions', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-unsafe-'));
  const config = createTempConfig(rootDir);

  const db = new SeFiDatabase(config);
  await db.init();

  const service = new ModelingService({ config, database: db });

  assert.throws(() => service.upsertModelFile('../escape.yml', 'content'), (error) => {
    assert.equal(error.code, 'INVALID_PATH');
    return true;
  });

  assert.throws(() => service.upsertModelFile('/tmp/not-allowed.yml', 'content'), (error) => {
    assert.equal(error.code, 'INVALID_PATH');
    return true;
  });

  assert.throws(() => service.upsertModelFile('generated/cubes/not-yaml.sql', 'content'), (error) => {
    assert.equal(error.code, 'INVALID_PATH');
    return true;
  });

  await db.close();
});

test('model storage status is persistent across service instances', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-persist-'));
  const config = createTempConfig(rootDir);

  const db1 = new SeFiDatabase(config);
  await db1.init();
  const service1 = new ModelingService({ config, database: db1 });
  service1.upsertModelFile('generated/cubes/persistent.yml', 'cubes:\n  - name: persistent\n');
  await db1.close();

  const db2 = new SeFiDatabase(config);
  await db2.init();
  const service2 = new ModelingService({ config, database: db2 });
  const status = service2.getModelStorageStatus();
  const files = service2.listModelFiles('generated');

  assert.equal(status.model_root_exists, true);
  assert.equal(status.generated_root_exists, true);
  assert.equal(status.generated_root_writable, true);
  assert.equal(files.files.some((file) => file.path === 'generated/cubes/persistent.yml'), true);

  await db2.close();
});

test('executeReadOnlyQuery enforces read-only SQL', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-query-'));
  const config = createTempConfig(rootDir);

  const db = new SeFiDatabase(config);
  await db.init();
  db.runStatement('CREATE TABLE IF NOT EXISTS read_test (id INTEGER PRIMARY KEY, label TEXT)');
  db.runStatement('INSERT INTO read_test (id, label) VALUES (?, ?)', [1, 'alpha']);

  const selectResult = db.executeReadOnlyQuery('SELECT id, label FROM read_test');
  assert.equal(selectResult.total_rows, 1);
  assert.deepEqual(selectResult.columns, ['id', 'label']);

  assert.throws(() => db.executeReadOnlyQuery('UPDATE read_test SET label = "beta" WHERE id = 1'));
  assert.throws(() => db.executeReadOnlyQuery('PRAGMA table_info(read_test)'));
  assert.throws(() => db.executeReadOnlyQuery('SELECT * FROM read_test; SELECT 1'));

  await db.close();
});

test('schema preview skips unsupported legacy tables and removes stale generated cubes', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-modeling-legacy-'));
  const config = createTempConfig(rootDir);
  const generatedRoot = path.join(config.cubeModelDir, 'generated', 'cubes');
  fs.mkdirSync(generatedRoot, { recursive: true });

  const legacyGeneratedPath = path.join(generatedRoot, 'balances.yml');
  fs.writeFileSync(legacyGeneratedPath, 'cubes:\n  - name: gen_balances\n', 'utf8');

  const db = new SeFiDatabase(config);
  await db.init();

  const service = new ModelingService({ config, database: db });
  const preview = service.buildPreview();

  assert.equal(preview.files.some((file) => file.file_name === 'balances.yml'), false);
  assert.equal(preview.removed_files.some((file) => file.file_name === 'balances.yml'), true);

  const applied = service.applyPreview(preview.preview_id);
  assert.equal(applied.removals_applied, 1);
  assert.equal(fs.existsSync(legacyGeneratedPath), false);

  await db.close();
});
