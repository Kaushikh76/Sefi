import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SeFiDatabase } from '../src/database.js';
import { createConfig } from '../src/config.js';

function createTempPaths(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempDir,
    dbPath: path.join(tempDir, 'sefi.db'),
    cubeDbPath: path.join(tempDir, 'sefi.cube.db'),
    manifestsDir: path.join(tempDir, 'manifests'),
  };
}

test('forceSave writes a readable Cube snapshot database', async () => {
  const { dbPath, cubeDbPath, manifestsDir } = createTempPaths('sefi-db-snapshot-');
  fs.mkdirSync(manifestsDir, { recursive: true });

  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestsDir,
  });

  const database = new SeFiDatabase(config);
  await database.init();

  database.registerContract({
    id: 'testnet:0.0.1001',
    name: 'Core Contract',
    category: 'core',
    evm: null,
    asset: 'HBAR',
    sourceFile: 'manifests/core.json',
  });
  database.insertContractLogs([
    {
      contract_id: 'testnet:0.0.1001',
      tx_hash: '0xabc',
      event_name: 'Transfer',
      topic0: '0x1',
      topic1: null,
      topic2: null,
      topic3: null,
      data: '0x0',
      block_number: 42,
      log_index: 0,
      timestamp: '123.000000001',
    },
  ]);

  await database.forceSave();

  assert.equal(fs.existsSync(cubeDbPath), true);

  const snapshotDb = new Database(cubeDbPath, { readonly: true });
  try {
    const contractCount = snapshotDb.prepare('SELECT COUNT(*) AS count FROM contracts').get().count;
    const logCount = snapshotDb.prepare('SELECT COUNT(*) AS count FROM contract_logs').get().count;
    const sourceFile = snapshotDb.prepare('SELECT source_file FROM contracts WHERE contract_id = ?').get('testnet:0.0.1001');

    assert.equal(contractCount, 1);
    assert.equal(logCount, 1);
    assert.equal(sourceFile.source_file, 'manifests/core.json');
  } finally {
    snapshotDb.close();
    await database.close();
  }
});

test('migrations preserve existing data and remain idempotent', async () => {
  const { dbPath, cubeDbPath, manifestsDir } = createTempPaths('sefi-db-migrate-');
  fs.mkdirSync(manifestsDir, { recursive: true });

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      evm_address TEXT,
      asset TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE contract_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      tx_hash TEXT,
      event_name TEXT,
      topic0 TEXT,
      topic1 TEXT,
      topic2 TEXT,
      topic3 TEXT,
      data TEXT,
      block_number INTEGER,
      log_index INTEGER,
      timestamp TEXT NOT NULL,
      indexed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE hts_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id TEXT NOT NULL,
      from_account TEXT,
      to_account TEXT,
      amount TEXT NOT NULL,
      tx_id TEXT,
      timestamp TEXT NOT NULL,
      indexed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE topic_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      tx_id TEXT,
      consensus_timestamp TEXT NOT NULL,
      indexed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT UNIQUE NOT NULL,
      entity_type TEXT NOT NULL,
      last_timestamp TEXT DEFAULT '0.0',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE stats (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  legacyDb.prepare(
    'INSERT INTO contracts (contract_id, name, category, evm_address, asset) VALUES (?, ?, ?, ?, ?)'
  ).run('testnet:0.0.1001', 'Legacy Contract', 'core', null, 'HBAR');
  legacyDb.prepare(
    'INSERT INTO contract_logs (contract_id, tx_hash, event_name, topic0, data, block_number, log_index, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('testnet:0.0.1001', '0xlog', 'Transfer', '0x1', '0x0', 7, 0, '1000.000000001');
  legacyDb.prepare(
    'INSERT INTO hts_transfers (token_id, from_account, to_account, amount, tx_id, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('testnet:0.0.2002', '0.0.1', '0.0.2', '10', '0.0.1-1000-1', '1001.000000001');
  legacyDb.prepare(
    'INSERT INTO topic_messages (topic_id, tx_id, consensus_timestamp) VALUES (?, ?, ?)'
  ).run('0.0.3003', '0.0.1-1002-1', '1002.000000001');
  legacyDb.prepare(
    'INSERT INTO sync_state (entity_id, entity_type, last_timestamp) VALUES (?, ?, ?)'
  ).run('testnet:0.0.1001', 'contract', '1000.000000001');
  legacyDb.prepare('INSERT INTO stats (key, value) VALUES (?, ?)').run('mode', 'idle');
  legacyDb.close();

  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestsDir,
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const contractsCount = database.queryOne('SELECT COUNT(*) AS count FROM contracts').count;
  const contractLogsCount = database.queryOne('SELECT COUNT(*) AS count FROM contract_logs').count;
  const htsTransfersCount = database.queryOne('SELECT COUNT(*) AS count FROM hts_transfers').count;
  const topicMessagesCount = database.queryOne('SELECT COUNT(*) AS count FROM topic_messages').count;
  const syncStateCount = database.queryOne('SELECT COUNT(*) AS count FROM sync_state').count;
  const statsCount = database.queryOne('SELECT COUNT(*) AS count FROM stats').count;
  const migrationCount = database.queryOne('SELECT COUNT(*) AS count FROM schema_migrations').count;
  const topicColumns = database.queryAll('PRAGMA table_info(topic_messages)');
  const syncStateColumns = database.queryAll('PRAGMA table_info(sync_state)');

  assert.equal(contractsCount, 1);
  assert.equal(contractLogsCount, 1);
  assert.equal(htsTransfersCount, 2);
  assert.equal(topicMessagesCount, 1);
  assert.equal(syncStateCount, 1);
  assert.ok(statsCount >= 1);
  assert.ok(migrationCount >= 1);
  assert.equal(topicColumns.some((column) => column.name === 'message_utf8'), true);
  assert.equal(syncStateColumns.some((column) => column.name === 'last_index'), true);
  assert.equal(syncStateColumns.some((column) => column.name === 'last_tx_id'), true);

  await database.close();

  const reopened = new SeFiDatabase(config);
  await reopened.init();
  const migrationCountAfterReopen = reopened.queryOne('SELECT COUNT(*) AS count FROM schema_migrations').count;
  const topicMessagesCountAfterReopen = reopened.queryOne('SELECT COUNT(*) AS count FROM topic_messages').count;

  assert.ok(migrationCountAfterReopen >= migrationCount);
  assert.equal(topicMessagesCountAfterReopen, 1);

  await reopened.close();
});
