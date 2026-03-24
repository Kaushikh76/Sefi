import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SeFiDatabase } from '../src/database.js';
import { createConfig } from '../src/config.js';

test('database insert methods are idempotent through unique constraints', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-db-'));
  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');

  const config = createConfig({ SEFI_DB_PATH: dbPath, SEFI_CUBE_DB_PATH: cubeDbPath, SEFI_MANIFESTS_DIR: tempDir });
  const database = new SeFiDatabase(config);
  await database.init();

  const logs = [
    {
      contract_id: '0.0.1001',
      tx_hash: '0xabc',
      event_name: 'Transfer',
      topic0: '0x1',
      topic1: '0x2',
      topic2: '0x3',
      topic3: null,
      data: '0x0',
      block_number: 10,
      log_index: 1,
      timestamp: '123.000000001',
    }
  ];

  const firstInsert = database.insertContractLogs(logs);
  const secondInsert = database.insertContractLogs(logs);

  assert.equal(firstInsert, 1);
  assert.equal(secondInsert, 0);

  const records = database.getRecentRecords('contract_logs', 10);
  assert.equal(records.length, 1);

  await database.close();
});

test('database init recovers from malformed sqlite file by backing up and recreating', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-db-corrupt-'));
  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  fs.writeFileSync(dbPath, 'not-a-valid-sqlite-file', 'utf8');

  const config = createConfig({ SEFI_DB_PATH: dbPath, SEFI_CUBE_DB_PATH: cubeDbPath, SEFI_MANIFESTS_DIR: tempDir });
  const database = new SeFiDatabase(config);
  await database.init();

  assert.ok(database.recoveryInfo, 'Expected recovery info to be populated');
  assert.equal(database.recoveryInfo.originalPath, dbPath);
  assert.ok(fs.existsSync(database.recoveryInfo.backupPath), 'Expected backup file to be created');

  const stats = database.getAllStats();
  assert.equal(stats.mode, 'idle');

  await database.close();
});
