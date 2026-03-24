import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const DEFAULT_DB_BUSY_TIMEOUT_MS = 5000;

function escapeSqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function fileSizeIfExists(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function sidecarPaths(basePath) {
  return [basePath, `${basePath}-wal`, `${basePath}-shm`];
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function bindStatement(method, stmt, params = []) {
  if (Array.isArray(params)) {
    return stmt[method](...params);
  }
  if (params === undefined || params === null) {
    return stmt[method]();
  }
  return stmt[method](params);
}

function parseJsonText(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeIsoDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function cleanupSnapshotSidecars(basePath) {
  for (const candidate of [`${basePath}-wal`, `${basePath}-shm`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.unlinkSync(candidate);
    } catch {
      // best-effort cleanup
    }
  }
}

function cleanupOldCorruptBackups(dbPath, maxAgeDays = 7) {
  const dirPath = path.dirname(dbPath);
  const baseName = path.basename(dbPath);
  const prefix = `${baseName}.corrupt.`;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(prefix)) continue;
    const fullPath = path.join(dirPath, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // best-effort cleanup
    }
  }
}

function cleanupTempSnapshots(basePath) {
  const dirPath = path.dirname(basePath);
  const prefix = `${path.basename(basePath)}.tmp-`;

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(prefix)) continue;

    try {
      fs.unlinkSync(path.join(dirPath, entry.name));
    } catch {
      // best-effort cleanup
    }
  }
}

function resolveRealPathSafe(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function tableExists(db, tableName) {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
  ).get(tableName);
  return Boolean(row?.name);
}

function columnExists(db, tableName, columnName) {
  if (!tableExists(db, tableName)) return false;
  const columns = db.prepare(`PRAGMA table_info(${escapeIdentifier(tableName)})`).all();
  return columns.some((column) => String(column.name).toLowerCase() === String(columnName).toLowerCase());
}

function ensureColumn(db, tableName, columnName, definition) {
  if (columnExists(db, tableName, columnName)) return;
  db.exec(`ALTER TABLE ${escapeIdentifier(tableName)} ADD COLUMN ${escapeIdentifier(columnName)} ${definition}`);
}

function isUniqueConstraintError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code.includes('SQLITE_CONSTRAINT_UNIQUE')) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique constraint');
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'create_core_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS contracts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          canonical_name TEXT,
          category TEXT NOT NULL,
          evm_address TEXT,
          asset TEXT,
          source_file TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS contract_logs (
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
          indexed_at TEXT DEFAULT (datetime('now')),
          UNIQUE(contract_id, tx_hash, log_index, timestamp)
        );

        CREATE TABLE IF NOT EXISTS hts_transfers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token_id TEXT NOT NULL,
          network TEXT,
          account_id TEXT NOT NULL,
          amount_signed TEXT NOT NULL,
          amount_abs TEXT NOT NULL,
          tx_id TEXT NOT NULL,
          consensus_timestamp TEXT NOT NULL,
          transfer_index INTEGER NOT NULL,
          is_approval INTEGER DEFAULT 0,
          indexed_at TEXT DEFAULT (datetime('now')),
          UNIQUE(token_id, tx_id, transfer_index, account_id, amount_signed, consensus_timestamp)
        );

        CREATE TABLE IF NOT EXISTS erc20_transfers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_id TEXT NOT NULL,
          token_name TEXT,
          from_address TEXT,
          to_address TEXT,
          amount TEXT NOT NULL,
          tx_hash TEXT,
          log_index INTEGER,
          timestamp TEXT NOT NULL,
          indexed_at TEXT DEFAULT (datetime('now')),
          UNIQUE(contract_id, tx_hash, log_index, from_address, to_address, amount)
        );

        CREATE TABLE IF NOT EXISTS hbar_transfers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_account TEXT,
          to_account TEXT,
          amount TEXT NOT NULL,
          tx_id TEXT,
          timestamp TEXT NOT NULL,
          indexed_at TEXT DEFAULT (datetime('now')),
          UNIQUE(from_account, to_account, amount, tx_id, timestamp)
        );

        CREATE TABLE IF NOT EXISTS balances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL,
          token_id TEXT NOT NULL,
          balance TEXT NOT NULL DEFAULT '0',
          last_updated TEXT DEFAULT (datetime('now')),
          UNIQUE(account_id, token_id)
        );

        CREATE TABLE IF NOT EXISTS topic_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id TEXT NOT NULL,
          sequence_number INTEGER,
          message_base64 TEXT,
          message_utf8 TEXT,
          payer_account_id TEXT,
          tx_id TEXT,
          consensus_timestamp TEXT NOT NULL,
          indexed_at TEXT DEFAULT (datetime('now')),
          UNIQUE(topic_id, sequence_number)
        );

        CREATE TABLE IF NOT EXISTS sync_state (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_id TEXT UNIQUE NOT NULL,
          entity_type TEXT NOT NULL,
          last_timestamp TEXT DEFAULT '0.0',
          last_tx_id TEXT,
          last_index INTEGER DEFAULT -1,
          items_synced INTEGER DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS stats (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS activity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          entity_name TEXT,
          message TEXT NOT NULL,
          timestamp TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ingest_errors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          reason TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(source, entity_type, entity_id, payload_hash)
        );
      `);

      ensureColumn(db, 'contracts', 'source_file', 'TEXT');
      ensureColumn(db, 'contracts', 'canonical_name', 'TEXT');
      ensureColumn(db, 'hts_transfers', 'is_approval', 'INTEGER DEFAULT 0');
      ensureColumn(db, 'hts_transfers', 'network', 'TEXT');
      ensureColumn(db, 'hts_transfers', 'account_id', 'TEXT');
      ensureColumn(db, 'hts_transfers', 'amount_signed', 'TEXT');
      ensureColumn(db, 'hts_transfers', 'amount_abs', 'TEXT');
      ensureColumn(db, 'hts_transfers', 'consensus_timestamp', 'TEXT');
      ensureColumn(db, 'hts_transfers', 'transfer_index', 'INTEGER DEFAULT 0');
      ensureColumn(db, 'topic_messages', 'sequence_number', 'INTEGER');
      ensureColumn(db, 'topic_messages', 'message_base64', 'TEXT');
      ensureColumn(db, 'topic_messages', 'message_utf8', 'TEXT');
      ensureColumn(db, 'topic_messages', 'payer_account_id', 'TEXT');
      ensureColumn(db, 'sync_state', 'last_index', 'INTEGER DEFAULT -1');
      ensureColumn(db, 'sync_state', 'last_tx_id', 'TEXT');
      ensureColumn(db, 'sync_state', 'items_synced', 'INTEGER DEFAULT 0');

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_contract_logs_contract_id ON contract_logs(contract_id);
        CREATE INDEX IF NOT EXISTS idx_contract_logs_timestamp ON contract_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_contract_logs_event_name ON contract_logs(event_name);
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_token_id ON hts_transfers(token_id);
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_network ON hts_transfers(network);
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_account_id ON hts_transfers(account_id);
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_consensus_timestamp ON hts_transfers(consensus_timestamp);
        CREATE INDEX IF NOT EXISTS idx_erc20_transfers_contract_id ON erc20_transfers(contract_id);
        CREATE INDEX IF NOT EXISTS idx_erc20_transfers_timestamp ON erc20_transfers(timestamp);
        CREATE INDEX IF NOT EXISTS idx_hbar_transfers_timestamp ON hbar_transfers(timestamp);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_hbar_transfers_tuple ON hbar_transfers(from_account, to_account, amount, tx_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_balances_account ON balances(account_id);
        CREATE INDEX IF NOT EXISTS idx_balances_token ON balances(token_id);
        CREATE INDEX IF NOT EXISTS idx_topic_messages_topic_id ON topic_messages(topic_id);
        CREATE INDEX IF NOT EXISTS idx_topic_messages_consensus_timestamp ON topic_messages(consensus_timestamp);
        CREATE INDEX IF NOT EXISTS idx_sync_state_entity_type ON sync_state(entity_type);
        CREATE INDEX IF NOT EXISTS idx_ingest_errors_created_at ON ingest_errors(created_at);
        CREATE INDEX IF NOT EXISTS idx_ingest_errors_source ON ingest_errors(source);
      `);
    },
  },
  {
    version: 2,
    name: 'backfill_known_event_names',
    up(db) {
      db.exec(`
        UPDATE contract_logs
           SET event_name = CASE lower(topic0)
             WHEN '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' THEN 'Transfer'
             WHEN '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925' THEN 'Approval'
             WHEN '0xde6857219544bb5b7746f48ed30be6386fefc61b2f864cacf559893bf50fd951' THEN 'Deposit'
             WHEN '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7' THEN 'Withdraw'
             WHEN '0xc6a898309e823ee50bac64e45ca8adba6690e99e7841c45d754e2a38e9019d9b' THEN 'Borrow'
             WHEN '0x4cdde6e09bb755c9a5589ebaec640bbfedff1362d4b255ebf8339782b9942faa' THEN 'Repay'
             WHEN '0x98636036cb66a9c19a37435efc1e90142190214e8abeb821bdba3f2990dd4c95' THEN 'Initialize'
             WHEN '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde' THEN 'Mint'
             WHEN '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c' THEN 'Burn'
             WHEN '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0' THEN 'Collect'
             WHEN '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67' THEN 'Swap'
             WHEN '0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633' THEN 'Flash'
             WHEN '0xac49e518f90a358f652e4400164f05a5d8f7e35e7747279bc3a93dbf584e125a' THEN 'IncreaseObservationCardinalityNext'
             WHEN '0x973d8d92bb299f4af6ce49b52a8adb85ae46b9f214c4c4fc06ac77401237b133' THEN 'SetFeeProtocol'
             WHEN '0x596b573906218d3411850b26a6b437d6c4522fdb43d2d2386263f86d50b8b151' THEN 'CollectProtocol'
             WHEN '0x5f2147fb558c977441fbdfebcf8cd5776606adc8da5ff95566fc2a4137e54d13' THEN 'Transfer(address,address,uint256,address)'
             ELSE event_name
           END
         WHERE event_name IS NULL
            OR event_name = ''
            OR event_name = 'Unknown';
      `);
    },
  },
  {
    version: 3,
    name: 'normalize_transfer_with_context_label',
    up(db) {
      db.exec(`
        UPDATE contract_logs
           SET event_name = 'Transfer(address,address,uint256,address)'
         WHERE lower(topic0) = '0x5f2147fb558c977441fbdfebcf8cd5776606adc8da5ff95566fc2a4137e54d13'
           AND event_name = 'TransferWithContext';
      `);
    },
  },
  {
    version: 4,
    name: 'replace_unknown_with_deterministic_topic_labels',
    up(db) {
      db.exec(`
        UPDATE contract_logs
           SET event_name = CASE lower(trim(coalesce(topic0, '')))
             WHEN '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' THEN 'Transfer'
             WHEN '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925' THEN 'Approval'
             WHEN '0xde6857219544bb5b7746f48ed30be6386fefc61b2f864cacf559893bf50fd951' THEN 'Deposit'
             WHEN '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7' THEN 'Withdraw'
             WHEN '0xc6a898309e823ee50bac64e45ca8adba6690e99e7841c45d754e2a38e9019d9b' THEN 'Borrow'
             WHEN '0x4cdde6e09bb755c9a5589ebaec640bbfedff1362d4b255ebf8339782b9942faa' THEN 'Repay'
             WHEN '0x98636036cb66a9c19a37435efc1e90142190214e8abeb821bdba3f2990dd4c95' THEN 'Initialize'
             WHEN '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde' THEN 'Mint'
             WHEN '0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c' THEN 'Burn'
             WHEN '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0' THEN 'Collect'
             WHEN '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67' THEN 'Swap'
             WHEN '0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633' THEN 'Flash'
             WHEN '0xac49e518f90a358f652e4400164f05a5d8f7e35e7747279bc3a93dbf584e125a' THEN 'IncreaseObservationCardinalityNext'
             WHEN '0x973d8d92bb299f4af6ce49b52a8adb85ae46b9f214c4c4fc06ac77401237b133' THEN 'SetFeeProtocol'
             WHEN '0x596b573906218d3411850b26a6b437d6c4522fdb43d2d2386263f86d50b8b151' THEN 'CollectProtocol'
             WHEN '0x5f2147fb558c977441fbdfebcf8cd5776606adc8da5ff95566fc2a4137e54d13' THEN 'Transfer(address,address,uint256,address)'
             WHEN '' THEN 'NoTopic0'
             ELSE 'Topic0:' || lower(trim(topic0))
           END
         WHERE event_name IS NULL
            OR trim(event_name) = ''
            OR lower(trim(event_name)) = 'unknown';
      `);
    },
  },
  {
    version: 5,
    name: 'create_agent_control_plane_tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          network TEXT NOT NULL,
          model_provider TEXT NOT NULL,
          model_name TEXT NOT NULL,
          system_prompt TEXT NOT NULL DEFAULT '',
          topics_json TEXT NOT NULL DEFAULT '[]',
          post_examples_json TEXT NOT NULL DEFAULT '[]',
          semantic_scope_json TEXT NOT NULL DEFAULT '{}',
          tool_allowlist_json TEXT NOT NULL DEFAULT '[]',
          publish_targets_json TEXT NOT NULL DEFAULT '{}',
          schedule_json TEXT NOT NULL DEFAULT '{}',
          env_refs_json TEXT NOT NULL DEFAULT '[]',
          runtime_status TEXT NOT NULL DEFAULT 'stopped',
          last_run_summary_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          status TEXT NOT NULL,
          mode TEXT NOT NULL,
          trigger_source TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          details_json TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          run_id TEXT,
          event_type TEXT NOT NULL,
          level TEXT NOT NULL DEFAULT 'info',
          message TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE,
          FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS agent_tool_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          tool_key TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          config_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(agent_id, tool_key),
          FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_env_refs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          ref_key TEXT NOT NULL,
          env_var_name TEXT NOT NULL,
          required INTEGER NOT NULL DEFAULT 1,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(agent_id, ref_key),
          FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          schedule_key TEXT NOT NULL,
          cron_expr TEXT,
          enabled INTEGER NOT NULL DEFAULT 0,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          config_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(agent_id, schedule_key),
          FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_topic_registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          network TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(agent_id, network, topic_id),
          FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
        CREATE INDEX IF NOT EXISTS idx_agents_runtime_status ON agents(runtime_status);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at);
        CREATE INDEX IF NOT EXISTS idx_agent_events_agent_id ON agent_events(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_agent_topic_network_topic ON agent_topic_registrations(network, topic_id);
      `);
    },
  },
  {
    version: 6,
    name: 'canonicalize_contracts_and_migrate_hts_to_ledger_deltas',
    up(db) {
      ensureColumn(db, 'contracts', 'canonical_name', 'TEXT');
      db.exec(`
        UPDATE contracts
           SET canonical_name = TRIM(
             CASE
               WHEN name LIKE '% [%]' AND instr(name, ' [') > 1 THEN SUBSTR(name, 1, instr(name, ' [') - 1)
               ELSE name
             END
           )
         WHERE canonical_name IS NULL OR TRIM(canonical_name) = '';
      `);

      ensureColumn(db, 'sync_state', 'last_tx_id', 'TEXT');

      db.exec(`
        CREATE TABLE IF NOT EXISTS ingest_errors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          reason TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(source, entity_type, entity_id, payload_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_ingest_errors_created_at ON ingest_errors(created_at);
        CREATE INDEX IF NOT EXISTS idx_ingest_errors_source ON ingest_errors(source);
      `);

      const htsColumns = db.prepare(`PRAGMA table_info(hts_transfers)`).all().map((column) => String(column.name));
      const hasLedgerDeltaColumns =
        htsColumns.includes('account_id') &&
        htsColumns.includes('amount_signed') &&
        htsColumns.includes('consensus_timestamp') &&
        htsColumns.includes('transfer_index');
      const hasLegacyPairColumns =
        htsColumns.includes('from_account') &&
        htsColumns.includes('to_account') &&
        htsColumns.includes('amount') &&
        htsColumns.includes('timestamp');

      if (hasLegacyPairColumns || !hasLedgerDeltaColumns) {
        db.exec(`ALTER TABLE hts_transfers RENAME TO hts_transfers_legacy`);
        db.exec(`
          CREATE TABLE hts_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id TEXT NOT NULL,
            network TEXT,
            account_id TEXT NOT NULL,
            amount_signed TEXT NOT NULL,
            amount_abs TEXT NOT NULL,
            tx_id TEXT NOT NULL,
            consensus_timestamp TEXT NOT NULL,
            transfer_index INTEGER NOT NULL,
            is_approval INTEGER DEFAULT 0,
            indexed_at TEXT DEFAULT (datetime('now')),
            UNIQUE(token_id, tx_id, transfer_index, account_id, amount_signed, consensus_timestamp)
          );
        `);

        const legacyColumns = new Set(
          db.prepare(`PRAGMA table_info(hts_transfers_legacy)`).all().map((column) => String(column.name))
        );
        const legacyHasPairColumns =
          legacyColumns.has('from_account') &&
          legacyColumns.has('to_account') &&
          legacyColumns.has('amount') &&
          legacyColumns.has('timestamp');

        if (legacyHasPairColumns) {
          db.exec(`
            INSERT OR IGNORE INTO hts_transfers (
              token_id, network, account_id, amount_signed, amount_abs, tx_id, consensus_timestamp, transfer_index, is_approval, indexed_at
            )
            SELECT
              token_id,
              CASE
                WHEN instr(token_id, ':') > 0 THEN substr(token_id, 1, instr(token_id, ':') - 1)
                ELSE NULL
              END AS network,
              from_account AS account_id,
              '-' || amount AS amount_signed,
              amount AS amount_abs,
              COALESCE(tx_id, '') AS tx_id,
              timestamp AS consensus_timestamp,
              0 AS transfer_index,
              COALESCE(is_approval, 0) AS is_approval,
              indexed_at
            FROM hts_transfers_legacy
            WHERE from_account IS NOT NULL AND trim(from_account) <> '' AND amount IS NOT NULL;

            INSERT OR IGNORE INTO hts_transfers (
              token_id, network, account_id, amount_signed, amount_abs, tx_id, consensus_timestamp, transfer_index, is_approval, indexed_at
            )
            SELECT
              token_id,
              CASE
                WHEN instr(token_id, ':') > 0 THEN substr(token_id, 1, instr(token_id, ':') - 1)
                ELSE NULL
              END AS network,
              to_account AS account_id,
              amount AS amount_signed,
              amount AS amount_abs,
              COALESCE(tx_id, '') AS tx_id,
              timestamp AS consensus_timestamp,
              1 AS transfer_index,
              COALESCE(is_approval, 0) AS is_approval,
              indexed_at
            FROM hts_transfers_legacy
            WHERE to_account IS NOT NULL AND trim(to_account) <> '' AND amount IS NOT NULL;
          `);

          if (
            legacyColumns.has('account_id') &&
            legacyColumns.has('amount_signed') &&
            legacyColumns.has('amount_abs') &&
            legacyColumns.has('consensus_timestamp')
          ) {
            db.exec(`
              INSERT OR IGNORE INTO hts_transfers (
                token_id, network, account_id, amount_signed, amount_abs, tx_id, consensus_timestamp, transfer_index, is_approval, indexed_at
              )
              SELECT
                token_id,
                network,
                account_id,
                amount_signed,
                amount_abs,
                COALESCE(tx_id, ''),
                consensus_timestamp,
                COALESCE(transfer_index, 0),
                COALESCE(is_approval, 0),
                indexed_at
              FROM hts_transfers_legacy
              WHERE account_id IS NOT NULL
                AND trim(account_id) <> ''
                AND amount_signed IS NOT NULL
                AND consensus_timestamp IS NOT NULL
                AND trim(consensus_timestamp) <> '';
            `);
          }
        } else {
          db.exec(`
            INSERT OR IGNORE INTO hts_transfers (
              token_id, network, account_id, amount_signed, amount_abs, tx_id, consensus_timestamp, transfer_index, is_approval, indexed_at
            )
            SELECT
              token_id,
              network,
              account_id,
              amount_signed,
              amount_abs,
              COALESCE(tx_id, ''),
              consensus_timestamp,
              COALESCE(transfer_index, 0),
              COALESCE(is_approval, 0),
              indexed_at
            FROM hts_transfers_legacy;
          `);
        }

        db.exec(`DROP TABLE IF EXISTS hts_transfers_legacy`);
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_token_id ON hts_transfers(token_id);
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_network ON hts_transfers(network);
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_account_id ON hts_transfers(account_id);
        CREATE INDEX IF NOT EXISTS idx_hts_transfers_consensus_timestamp ON hts_transfers(consensus_timestamp);
      `);
    },
  },
  {
    version: 7,
    name: 'dedupe_hbar_transfers_and_enforce_unique_tuple',
    up(db) {
      db.exec(`
        DELETE FROM hbar_transfers
         WHERE id NOT IN (
           SELECT MIN(id)
           FROM hbar_transfers
           GROUP BY from_account, to_account, amount, tx_id, timestamp
         );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_hbar_transfers_tuple
          ON hbar_transfers(from_account, to_account, amount, tx_id, timestamp);
      `);
    },
  },
  {
    version: 8,
    name: 'add_model_ai_drafts_and_custom_api_endpoints',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_model_drafts (
          id TEXT PRIMARY KEY,
          intent_text TEXT NOT NULL,
          constraints_text TEXT,
          target_path TEXT NOT NULL,
          generated_yaml TEXT NOT NULL,
          rationale TEXT,
          warnings_json TEXT NOT NULL DEFAULT '[]',
          validation_json TEXT NOT NULL DEFAULT '{}',
          context_hash TEXT NOT NULL,
          llm_model TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          approved_path TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          approved_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_ai_model_drafts_created_at ON ai_model_drafts(created_at);
        CREATE INDEX IF NOT EXISTS idx_ai_model_drafts_status ON ai_model_drafts(status);

        CREATE TABLE IF NOT EXISTS api_endpoints (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          query_template_json TEXT NOT NULL,
          params_schema_json TEXT NOT NULL DEFAULT '[]',
          last_run_at TEXT,
          last_run_status TEXT,
          last_run_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_api_endpoints_slug ON api_endpoints(slug);
        CREATE INDEX IF NOT EXISTS idx_api_endpoints_enabled ON api_endpoints(enabled);
      `);
    },
  },
  {
    version: 9,
    name: 'add_derived_tables_workspace_and_clmm_vault_backing_tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS external_sources (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          is_system INTEGER NOT NULL DEFAULT 0,
          preset_key TEXT,
          base_url TEXT NOT NULL,
          auth_mode TEXT NOT NULL DEFAULT 'none',
          auth_config_json TEXT NOT NULL DEFAULT '{}',
          request_json TEXT NOT NULL DEFAULT '{}',
          normalization_json TEXT NOT NULL DEFAULT '{}',
          last_success_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS external_source_runs (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          status TEXT NOT NULL,
          trigger_source TEXT NOT NULL DEFAULT 'manual',
          http_status INTEGER,
          records_fetched INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          started_at TEXT NOT NULL,
          finished_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(source_id) REFERENCES external_sources(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS external_source_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          run_id TEXT,
          record_key TEXT NOT NULL,
          payload_json TEXT,
          normalized_json TEXT,
          observed_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(source_id, record_key),
          FOREIGN KEY(source_id) REFERENCES external_sources(id) ON DELETE CASCADE,
          FOREIGN KEY(run_id) REFERENCES external_source_runs(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS derived_pipelines (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          realtime_enabled INTEGER NOT NULL DEFAULT 1,
          is_system INTEGER NOT NULL DEFAULT 0,
          preset_key TEXT,
          target_table TEXT NOT NULL,
          schedule_json TEXT NOT NULL DEFAULT '{}',
          spec_json TEXT NOT NULL DEFAULT '{}',
          last_run_at TEXT,
          last_run_status TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS derived_pipeline_runs (
          id TEXT PRIMARY KEY,
          pipeline_id TEXT NOT NULL,
          status TEXT NOT NULL,
          trigger_source TEXT NOT NULL DEFAULT 'manual',
          rows_read INTEGER NOT NULL DEFAULT 0,
          rows_written INTEGER NOT NULL DEFAULT 0,
          cursor_before TEXT,
          cursor_after TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          error TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(pipeline_id) REFERENCES derived_pipelines(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS derived_pipeline_cursors (
          pipeline_id TEXT PRIMARY KEY,
          cursor_value TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(pipeline_id) REFERENCES derived_pipelines(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS clmm_pool_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          pool_address TEXT,
          dex_name TEXT,
          token0_symbol TEXT,
          token1_symbol TEXT,
          fee_tier_bps REAL,
          current_tick REAL,
          sqrt_price_x96 TEXT,
          spot_price REAL,
          active_liquidity REAL,
          tvl_usd REAL,
          block_number REAL,
          snapshot_at TEXT,
          indexed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS clmm_positions (
          position_id TEXT PRIMARY KEY,
          pool_address TEXT,
          vault_address TEXT,
          strategy_address TEXT,
          owner_address TEXT,
          token0_symbol TEXT,
          token1_symbol TEXT,
          tick_lower REAL,
          tick_upper REAL,
          liquidity REAL,
          amount0 REAL,
          amount1 REAL,
          fees_owed0 REAL,
          fees_owed1 REAL,
          is_active INTEGER,
          minted_at TEXT,
          last_updated_at TEXT,
          indexed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS vault_strategy_state (
          vault_address TEXT PRIMARY KEY,
          vault_name TEXT,
          strategy_address TEXT,
          pool_address TEXT,
          asset_pair TEXT,
          current_position_id TEXT,
          token0_symbol TEXT,
          token1_symbol TEXT,
          current_tick REAL,
          active_lower_tick REAL,
          active_upper_tick REAL,
          in_range INTEGER,
          distance_to_lower REAL,
          distance_to_upper REAL,
          idle_ratio REAL,
          deployed_ratio REAL,
          idle_usd REAL,
          deployed_usd REAL,
          tvl_usd REAL,
          share_price REAL,
          rebalance_count_24h REAL,
          last_rebalance_at TEXT,
          state_at TEXT,
          indexed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS vault_actions_decoded (
          action_id TEXT PRIMARY KEY,
          vault_address TEXT,
          strategy_address TEXT,
          pool_address TEXT,
          tx_hash TEXT,
          actor_address TEXT,
          action_type TEXT,
          position_id TEXT,
          tick_lower REAL,
          tick_upper REAL,
          amount0 REAL,
          amount1 REAL,
          shares REAL,
          value_usd REAL,
          block_number REAL,
          action_at TEXT,
          indexed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS price_volatility_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          market_key TEXT,
          base_symbol TEXT,
          quote_symbol TEXT,
          source TEXT,
          interval_label TEXT,
          price REAL,
          return_1h REAL,
          return_6h REAL,
          return_24h REAL,
          realized_vol_1h REAL,
          realized_vol_6h REAL,
          realized_vol_24h REAL,
          snapshot_at TEXT,
          indexed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS clmm_agent_state (
          state_id TEXT PRIMARY KEY,
          vault_address TEXT,
          vault_name TEXT,
          strategy_address TEXT,
          pool_address TEXT,
          asset_pair TEXT,
          current_tick REAL,
          active_lower_tick REAL,
          active_upper_tick REAL,
          in_range INTEGER,
          distance_to_lower REAL,
          distance_to_upper REAL,
          nearest_boundary_distance REAL,
          idle_ratio REAL,
          deployed_ratio REAL,
          tvl_usd REAL,
          realized_vol_1h REAL,
          realized_vol_6h REAL,
          realized_vol_24h REAL,
          risk_regime TEXT,
          suggested_action TEXT,
          confidence_score REAL,
          reason_summary TEXT,
          last_rebalance_at TEXT,
          state_at TEXT,
          indexed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_external_sources_slug ON external_sources(slug);
        CREATE INDEX IF NOT EXISTS idx_external_sources_enabled ON external_sources(enabled);
        CREATE INDEX IF NOT EXISTS idx_external_source_runs_source_id ON external_source_runs(source_id);
        CREATE INDEX IF NOT EXISTS idx_external_source_runs_started_at ON external_source_runs(started_at);
        CREATE INDEX IF NOT EXISTS idx_external_source_records_source_id ON external_source_records(source_id);
        CREATE INDEX IF NOT EXISTS idx_external_source_records_observed_at ON external_source_records(observed_at);

        CREATE INDEX IF NOT EXISTS idx_derived_pipelines_slug ON derived_pipelines(slug);
        CREATE INDEX IF NOT EXISTS idx_derived_pipelines_enabled ON derived_pipelines(enabled);
        CREATE INDEX IF NOT EXISTS idx_derived_pipeline_runs_pipeline_id ON derived_pipeline_runs(pipeline_id);
        CREATE INDEX IF NOT EXISTS idx_derived_pipeline_runs_started_at ON derived_pipeline_runs(started_at);

        CREATE INDEX IF NOT EXISTS idx_clmm_pool_snapshots_pool_snapshot ON clmm_pool_snapshots(pool_address, snapshot_at);
        CREATE INDEX IF NOT EXISTS idx_clmm_pool_snapshots_block ON clmm_pool_snapshots(block_number);
        CREATE INDEX IF NOT EXISTS idx_clmm_pool_snapshots_snapshot_at ON clmm_pool_snapshots(snapshot_at);

        CREATE INDEX IF NOT EXISTS idx_clmm_positions_pool_updated ON clmm_positions(pool_address, last_updated_at);
        CREATE INDEX IF NOT EXISTS idx_clmm_positions_vault_updated ON clmm_positions(vault_address, last_updated_at);
        CREATE INDEX IF NOT EXISTS idx_clmm_positions_active ON clmm_positions(is_active);

        CREATE INDEX IF NOT EXISTS idx_vault_strategy_state_pool ON vault_strategy_state(pool_address);
        CREATE INDEX IF NOT EXISTS idx_vault_strategy_state_strategy ON vault_strategy_state(strategy_address);
        CREATE INDEX IF NOT EXISTS idx_vault_strategy_state_state_at ON vault_strategy_state(state_at);

        CREATE INDEX IF NOT EXISTS idx_vault_actions_decoded_vault_action_at ON vault_actions_decoded(vault_address, action_at);
        CREATE INDEX IF NOT EXISTS idx_vault_actions_decoded_action_type ON vault_actions_decoded(action_type, action_at);
        CREATE INDEX IF NOT EXISTS idx_vault_actions_decoded_tx_hash ON vault_actions_decoded(tx_hash);
        CREATE INDEX IF NOT EXISTS idx_vault_actions_decoded_action_at ON vault_actions_decoded(action_at);

        CREATE INDEX IF NOT EXISTS idx_price_volatility_snapshots_market_at ON price_volatility_snapshots(market_key, snapshot_at);
        CREATE INDEX IF NOT EXISTS idx_price_volatility_snapshots_symbols_at ON price_volatility_snapshots(base_symbol, quote_symbol, snapshot_at);
        CREATE INDEX IF NOT EXISTS idx_price_volatility_snapshots_snapshot_at ON price_volatility_snapshots(snapshot_at);

        CREATE INDEX IF NOT EXISTS idx_clmm_agent_state_vault_state_at ON clmm_agent_state(vault_address, state_at);
        CREATE INDEX IF NOT EXISTS idx_clmm_agent_state_action_state_at ON clmm_agent_state(suggested_action, state_at);
      `);
    },
  },
  {
    version: 10,
    name: 'add_per_contract_derived_cursors_and_scalability_indexes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS derived_pipeline_contract_cursors (
          pipeline_id TEXT NOT NULL,
          contract_id TEXT NOT NULL,
          cursor_log_id INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY(pipeline_id, contract_id),
          FOREIGN KEY(pipeline_id) REFERENCES derived_pipelines(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_derived_pipeline_contract_cursors_pipeline
          ON derived_pipeline_contract_cursors(pipeline_id, cursor_log_id);
        CREATE INDEX IF NOT EXISTS idx_derived_pipeline_contract_cursors_contract
          ON derived_pipeline_contract_cursors(contract_id, cursor_log_id);

        CREATE INDEX IF NOT EXISTS idx_contract_logs_contract_id_id ON contract_logs(contract_id, id);
        CREATE INDEX IF NOT EXISTS idx_contract_logs_id_contract_id ON contract_logs(id, contract_id);
        CREATE INDEX IF NOT EXISTS idx_contracts_category ON contracts(category);
        CREATE INDEX IF NOT EXISTS idx_contracts_evm_address ON contracts(evm_address);
        CREATE INDEX IF NOT EXISTS idx_sync_state_entity_items ON sync_state(entity_type, items_synced, entity_id);
      `);
    },
  },
  {
    version: 11,
    name: 'add_agent_chat_sessions_messages_and_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_chat_sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          title TEXT,
          mode TEXT NOT NULL DEFAULT 'stateful',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          auto_execute INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_message_at TEXT
        );

        CREATE TABLE IF NOT EXISTS agent_chat_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'completed',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(session_id) REFERENCES agent_chat_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS agent_chat_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          message_id TEXT,
          event_type TEXT NOT NULL,
          level TEXT NOT NULL DEFAULT 'info',
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(session_id) REFERENCES agent_chat_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY(message_id) REFERENCES agent_chat_messages(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_chat_sessions_agent_id
          ON agent_chat_sessions(agent_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_chat_sessions_last_message_at
          ON agent_chat_sessions(last_message_at DESC);

        CREATE INDEX IF NOT EXISTS idx_agent_chat_messages_session_id
          ON agent_chat_messages(session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_chat_messages_role
          ON agent_chat_messages(role, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_agent_chat_events_session_id
          ON agent_chat_events(session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_chat_events_event_type
          ON agent_chat_events(event_type, created_at DESC);
      `);
    },
  },
];

export class SeFiDatabase {
  constructor(config) {
    this.config = config;
    this.db = null;
    this.lastSaveTime = Date.now();
    this.saveTimeout = null;
    this.walCheckpointInterval = null;
    this.snapshotsEnabled = false;
    this.isSaving = false;
    this.SAVE_INTERVAL_MS = this.config.saveIntervalMs || 30000;
    this.SAVE_DEBOUNCE_MS = this.config.saveDebounceMs || 5000;
    this.recoveryInfo = null;
    this.hasPendingSave = false;
    this.lastSaveAt = null;
    this.lastSaveDurationMs = 0;
    this.lastSaveError = null;
    this.metricsCacheTtlMs = Number(this.config.dbMetricsCacheTtlMs) || 4000;
    this.metricsCache = null;
    this.metricsCacheExpiresAt = 0;
    this.lastReadOkAt = null;
    this.lastReadOkAtMs = 0;
    this.lastReadError = null;
    this.lastReadErrorAt = null;
    this.lastReadErrorAtMs = 0;
    this.lastReadDurationMs = 0;
    this.dbBusyTimeoutMs = DEFAULT_DB_BUSY_TIMEOUT_MS;
  }

  async init() {
    if (this.db) return this.db;

    ensureDirectory(this.config.dbPath);
    ensureDirectory(this.config.cubeDbPath);
    cleanupTempSnapshots(this.config.cubeDbPath);
    cleanupOldCorruptBackups(this.config.dbPath, 7);

    const openConnection = () => {
      const db = new Database(this.config.dbPath);
      db.pragma(`busy_timeout = ${this.dbBusyTimeoutMs}`);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');
      db.pragma('temp_store = MEMORY');
      db.pragma('mmap_size = 0');
      db.pragma('wal_autocheckpoint = 500');
      db.prepare('SELECT 1 AS ok').get();
      return db;
    };

    const recoverFromCorruption = (reason) => {
      if (this.db) {
        try {
          this.db.close();
        } catch {
          // ignore close failures during recovery
        }
        this.db = null;
      }

      const suffix = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.config.dbPath}.corrupt.${suffix}.bak`;

      if (fs.existsSync(this.config.dbPath)) {
        try {
          fs.renameSync(this.config.dbPath, backupPath);
        } catch {
          fs.copyFileSync(this.config.dbPath, backupPath);
          fs.unlinkSync(this.config.dbPath);
        }
      }

      for (const sidecarPath of [`${this.config.dbPath}-wal`, `${this.config.dbPath}-shm`]) {
        if (!fs.existsSync(sidecarPath)) continue;
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          // ignore stale sidecar cleanup failures
        }
      }

      this.recoveryInfo = {
        reason,
        originalPath: this.config.dbPath,
        backupPath,
        recoveredAt: new Date().toISOString(),
      };
      this.db = openConnection();
    };

    try {
      this.db = openConnection();
      this.runMigrations();
    } catch (error) {
      const message = String(error?.message || 'Unknown SQLite open error');
      const isCorruption = /(malformed|not a database|disk image|database disk image|file is not a database)/i.test(message);

      if (!isCorruption) {
        throw error;
      }

      recoverFromCorruption(message);
      this.runMigrations();
    }

    this.probeReadiness();
    this.getOverviewCached({ force: true, allowStale: true });

    this.walCheckpointInterval = setInterval(() => {
      try {
        if (this.db) this.db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // best-effort checkpoint
      }
    }, 30_000);

    if (this.shouldRefreshCubeSnapshotOnInit()) {
      await this.forceSave();
    }

    return this.db;
  }

  runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const appliedVersions = new Set(
      this.db
        .prepare(`SELECT version FROM schema_migrations ORDER BY version ASC`)
        .all()
        .map((row) => Number(row.version))
    );

    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;

      const applyMigration = this.db.transaction(() => {
        migration.up(this.db);
        this.db
          .prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime('now'))`)
          .run(migration.version, migration.name);
      });

      applyMigration.immediate();
    }

    const defaultStats = [
      ['mode', 'idle'],
      ['total_api_calls', '0'],
      ['last_rate_limit', ''],
      ['last_sync_contract_logs', '0'],
      ['last_sync_hts_transfers', '0'],
      ['last_sync_topic_messages', '0'],
      ['sync_started_at', ''],
      ['listen_started_at', ''],
      ['manifests_loaded', '0'],
    ];

    const stmt = this.db.prepare(`INSERT OR IGNORE INTO stats (key, value) VALUES (?, ?)`);
    for (const [key, value] of defaultStats) {
      stmt.run(key, value);
    }
  }

  shouldRefreshCubeSnapshotOnInit() {
    const liveRealPath = resolveRealPathSafe(this.config.dbPath);
    const cubeRealPath = resolveRealPathSafe(this.config.cubeDbPath);
    if (liveRealPath && cubeRealPath && liveRealPath === cubeRealPath) {
      return false;
    }

    if (!fs.existsSync(this.config.cubeDbPath)) {
      return true;
    }

    try {
      const liveMtime = fs.statSync(this.config.dbPath).mtimeMs;
      const cubeMtime = fs.statSync(this.config.cubeDbPath).mtimeMs;
      return liveMtime > cubeMtime;
    } catch {
      return true;
    }
  }

  invalidateMetricsCache() {
    this.metricsCacheExpiresAt = 0;
  }

  markReadSuccess(durationMs = 0) {
    const now = Date.now();
    this.lastReadOkAtMs = now;
    this.lastReadOkAt = new Date(now).toISOString();
    this.lastReadDurationMs = durationMs;
    this.lastReadError = null;
    this.lastReadErrorAt = null;
    this.lastReadErrorAtMs = 0;
  }

  markReadFailure(error, durationMs = 0) {
    const now = Date.now();
    this.lastReadDurationMs = durationMs;
    this.lastReadError = error instanceof Error ? error.message : String(error);
    this.lastReadErrorAtMs = now;
    this.lastReadErrorAt = new Date(now).toISOString();
  }

  getReadTelemetry() {
    return {
      db_status: this.getDbStatus(),
      db_last_read_ok_at: this.lastReadOkAt,
      db_last_read_error: this.lastReadError,
      db_last_read_error_at: this.lastReadErrorAt,
      db_last_read_duration_ms: this.lastReadDurationMs,
    };
  }

  getDbStatus() {
    const maxAgeMs = Math.max(1000, Number(this.config.dbReadProbeMaxAgeMs) || 15000);
    if (!this.lastReadOkAtMs) {
      return 'starting';
    }

    const ageMs = Date.now() - this.lastReadOkAtMs;
    if (ageMs > maxAgeMs * 2) {
      return 'degraded';
    }

    if (this.lastReadErrorAtMs > this.lastReadOkAtMs) {
      return 'degraded';
    }

    return 'up';
  }

  probeReadiness() {
    const startedAt = Date.now();
    try {
      const row = this.queryOne('SELECT 1 AS ok');
      const ok = Number(row?.ok) === 1;
      const durationMs = Date.now() - startedAt;
      if (!ok) {
        throw new Error('Database read probe returned unexpected value');
      }
      this.markReadSuccess(durationMs);
      return {
        ok: true,
        duration_ms: durationMs,
        checked_at: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.markReadFailure(error, durationMs);
      return {
        ok: false,
        duration_ms: durationMs,
        checked_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  buildOverviewSnapshot() {
    const dbInfo = this.getDatabaseInfo();
    const stats = this.getAllStats();
    return {
      database: dbInfo,
      stats,
      records_indexed:
        dbInfo.total_contract_logs +
        dbInfo.total_hts_transfers +
        dbInfo.total_erc20_transfers +
        dbInfo.total_topic_messages,
    };
  }

  getOverviewCached(options = {}) {
    const force = options.force === true;
    const allowStale = options.allowStale !== false;
    const preferCache = options.preferCache === true;
    const now = Date.now();

    if (!force && this.metricsCache && (preferCache || now < this.metricsCacheExpiresAt)) {
      return {
        ...this.metricsCache,
        source: preferCache && now >= this.metricsCacheExpiresAt ? 'cache_stale' : 'cache',
        status_age_ms: Math.max(0, now - (this.metricsCache.generated_at_ms || now)),
      };
    }

    const startedAt = Date.now();
    try {
      const snapshot = this.buildOverviewSnapshot();
      const generatedAtMs = Date.now();
      this.metricsCache = {
        ...snapshot,
        generated_at: new Date(generatedAtMs).toISOString(),
        generated_at_ms: generatedAtMs,
      };
      this.metricsCacheExpiresAt = generatedAtMs + this.metricsCacheTtlMs;
      this.markReadSuccess(generatedAtMs - startedAt);
      return {
        ...this.metricsCache,
        source: 'live',
        status_age_ms: 0,
      };
    } catch (error) {
      this.markReadFailure(error, Date.now() - startedAt);
      if (allowStale && this.metricsCache) {
        return {
          ...this.metricsCache,
          source: 'stale_cache',
          stale: true,
          stale_reason: error instanceof Error ? error.message : String(error),
          status_age_ms: Math.max(0, now - (this.metricsCache.generated_at_ms || now)),
        };
      }
      throw error;
    }
  }

  async atomicReplaceCubeSnapshot(tempPath) {
    const snapshotDir = path.dirname(this.config.cubeDbPath);
    ensureDirectory(this.config.cubeDbPath);
    fs.renameSync(tempPath, this.config.cubeDbPath);

    try {
      const dirFd = fs.openSync(snapshotDir, 'r');
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch {
      // Directory fsync is best-effort on some environments.
    }

    cleanupSnapshotSidecars(this.config.cubeDbPath);
  }

  async writeCubeSnapshot() {
    const liveRealPath = resolveRealPathSafe(this.config.dbPath);
    const cubeRealPath = resolveRealPathSafe(this.config.cubeDbPath);
    if (liveRealPath && cubeRealPath && liveRealPath === cubeRealPath) {
      return;
    }

    const snapshotDir = path.dirname(this.config.cubeDbPath);
    ensureDirectory(this.config.cubeDbPath);
    cleanupTempSnapshots(this.config.cubeDbPath);

    const tempPath = path.join(
      snapshotDir,
      `${path.basename(this.config.cubeDbPath)}.tmp-${process.pid}-${Date.now()}`
    );

    try {
      // Checkpoint live DB first to minimize WAL data copied into snapshot
      try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort */ }
      await this.db.backup(tempPath);
      const snapshotDb = new Database(tempPath);
      snapshotDb.pragma('journal_mode = DELETE');
      snapshotDb.pragma('wal_checkpoint(TRUNCATE)');
      snapshotDb.close();
      await this.atomicReplaceCubeSnapshot(tempPath);
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // best-effort cleanup
        }
      }
      cleanupSnapshotSidecars(tempPath);
      throw error;
    }
  }

  enableSnapshots() {
    this.snapshotsEnabled = true;
    this.scheduleSave();
  }

  scheduleSave() {
    if (!this.snapshotsEnabled) return;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    const intervalMs = this.getEffectiveSaveIntervalMs();
    const debounceMs = this.getEffectiveSaveDebounceMs(intervalMs);
    const elapsed = Date.now() - this.lastSaveTime;
    const delay = elapsed >= intervalMs ? 0 : Math.min(debounceMs, intervalMs - elapsed);

    this.saveTimeout = setTimeout(() => {
      this.saveDatabaseAsync().catch((error) => {
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            event: 'cube_snapshot_schedule_error',
            error: error instanceof Error ? error.message : String(error),
          })
        );
      });
    }, delay);
  }

  getEffectiveSaveIntervalMs() {
    const base = Math.max(1000, Number(this.SAVE_INTERVAL_MS) || 30000);
    const sizeBytes = this.getDbSizeBytes();

    if (sizeBytes >= 1024 * 1024 * 1024) {
      return Math.max(base, 30 * 60 * 1000);
    }
    if (sizeBytes >= 256 * 1024 * 1024) {
      return Math.max(base, 10 * 60 * 1000);
    }
    return base;
  }

  getEffectiveSaveDebounceMs(intervalMs) {
    const baseDebounce = Math.max(250, Number(this.SAVE_DEBOUNCE_MS) || 5000);
    return Math.min(baseDebounce, intervalMs);
  }

  async saveDatabaseAsync() {
    if (!this.db) return;
    if (this.isSaving) {
      this.hasPendingSave = true;
      return;
    }

    this.isSaving = true;
    const startedAt = Date.now();
    try {
      do {
        this.hasPendingSave = false;
        await this.writeCubeSnapshot();
        this.lastSaveTime = Date.now();
        this.lastSaveAt = new Date(this.lastSaveTime).toISOString();
        this.lastSaveError = null;
      } while (this.hasPendingSave);
      this.lastSaveDurationMs = Date.now() - startedAt;
    } catch (error) {
      this.lastSaveDurationMs = Date.now() - startedAt;
      this.lastSaveError = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          event: 'cube_snapshot_failed',
          duration_ms: this.lastSaveDurationMs,
          error: this.lastSaveError,
          cube_db_path: this.config.cubeDbPath,
        })
      );
    } finally {
      this.isSaving = false;
    }
  }

  async forceSave() {
    this.hasPendingSave = true;
    await this.saveDatabaseAsync();
  }

  runStatement(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const result = bindStatement('run', stmt, params);
    this.invalidateMetricsCache();
    return Number(result.changes || 0);
  }

  queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return bindStatement('all', stmt, params);
  }

  queryOne(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return bindStatement('get', stmt, params) || null;
  }

  getDbSizeBytes() {
    return sidecarPaths(this.config.dbPath).reduce((total, candidate) => total + fileSizeIfExists(candidate), 0);
  }

  isDatabaseFull() {
    return this.getDbSizeBytes() >= this.config.maxDbSizeBytes;
  }

  registerContract(contract) {
    this.db
      .prepare(
        `INSERT INTO contracts (contract_id, name, canonical_name, category, evm_address, asset, source_file)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(contract_id) DO UPDATE SET
           name = excluded.name,
           canonical_name = excluded.canonical_name,
           category = excluded.category,
           evm_address = excluded.evm_address,
           asset = excluded.asset,
           source_file = excluded.source_file`
      )
      .run(
        contract.id,
        contract.name,
        contract.canonicalName || contract.name,
        contract.category,
        contract.evm || null,
        contract.asset || null,
        contract.sourceFile || null
      );
    this.invalidateMetricsCache();
    this.scheduleSave();
  }

  removeLegacyUnscopedContracts(scopedIds) {
    if (!scopedIds || scopedIds.length === 0) return 0;
    const rawIds = new Set();
    for (const scopedId of scopedIds) {
      const colonIndex = scopedId.indexOf(':');
      if (colonIndex > 0) {
        rawIds.add(scopedId.slice(colonIndex + 1));
      }
    }
    if (rawIds.size === 0) return 0;

    const placeholders = Array.from(rawIds).map(() => '?').join(',');
    const values = Array.from(rawIds);
    const before =
      this.queryOne(`SELECT COUNT(*) AS count FROM contracts WHERE contract_id IN (${placeholders})`, values)
        ?.count || 0;
    if (before === 0) return 0;

    this.runStatement(`DELETE FROM contracts WHERE contract_id IN (${placeholders})`, values);
    return before;
  }

  insertContractLogs(logs) {
    if (!Array.isArray(logs) || logs.length === 0) return 0;
    let inserted = 0;
    const stmt = this.db.prepare(
      `INSERT INTO contract_logs (
        contract_id,
        tx_hash,
        event_name,
        topic0,
        topic1,
        topic2,
        topic3,
        data,
        block_number,
        log_index,
        timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = this.db.transaction((items) => {
      for (const log of items) {
        try {
          const logIndex = Number.isFinite(log.log_index)
            ? Number(log.log_index)
            : Number.parseInt(log.log_index, 10);
          const result = stmt.run(
            log.contract_id,
            log.tx_hash || null,
            log.event_name || 'Unknown',
            log.topic0 || null,
            log.topic1 || null,
            log.topic2 || null,
            log.topic3 || null,
            log.data || null,
            log.block_number ?? null,
            Number.isFinite(logIndex) ? logIndex : -1,
            log.timestamp
          );
          inserted += Number(result.changes || 0);
        } catch (error) {
          if (isUniqueConstraintError(error)) continue;
          throw error;
        }
      }
    });

    insertMany.immediate(logs);

    if (inserted > 0) {
      this.invalidateMetricsCache();
      this.scheduleSave();
    }

    return inserted;
  }

  insertHtsTransfers(transfers) {
    if (!Array.isArray(transfers) || transfers.length === 0) return 0;
    let inserted = 0;
    const stmt = this.db.prepare(
      `INSERT INTO hts_transfers (
        token_id,
        network,
        account_id,
        amount_signed,
        amount_abs,
        tx_id,
        consensus_timestamp,
        transfer_index,
        is_approval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = this.db.transaction((items) => {
      for (const transfer of items) {
        try {
          const transferIndex = Number.isFinite(transfer.transfer_index)
            ? Number(transfer.transfer_index)
            : Number.parseInt(transfer.transfer_index, 10);
          const result = stmt.run(
            transfer.token_id,
            transfer.network || null,
            transfer.account_id,
            transfer.amount_signed,
            transfer.amount_abs,
            transfer.tx_id,
            transfer.consensus_timestamp,
            Number.isFinite(transferIndex) ? transferIndex : 0,
            transfer.is_approval ? 1 : 0
          );
          inserted += Number(result.changes || 0);
        } catch (error) {
          if (isUniqueConstraintError(error)) continue;
          throw error;
        }
      }
    });

    insertMany.immediate(transfers);

    if (inserted > 0) {
      this.invalidateMetricsCache();
      this.scheduleSave();
    }

    return inserted;
  }

  insertErc20Transfers(transfers) {
    if (!Array.isArray(transfers) || transfers.length === 0) return 0;
    let inserted = 0;
    const stmt = this.db.prepare(
      `INSERT INTO erc20_transfers (
        contract_id,
        token_name,
        from_address,
        to_address,
        amount,
        tx_hash,
        log_index,
        timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = this.db.transaction((items) => {
      for (const transfer of items) {
        try {
          const logIndex = Number.isFinite(transfer.log_index)
            ? Number(transfer.log_index)
            : Number.parseInt(transfer.log_index, 10);
          const result = stmt.run(
            transfer.contract_id,
            transfer.token_name || null,
            transfer.from_address || null,
            transfer.to_address || null,
            transfer.amount,
            transfer.tx_hash || null,
            Number.isFinite(logIndex) ? logIndex : -1,
            transfer.timestamp
          );
          inserted += Number(result.changes || 0);
        } catch (error) {
          if (isUniqueConstraintError(error)) continue;
          throw error;
        }
      }
    });

    insertMany.immediate(transfers);

    if (inserted > 0) {
      this.invalidateMetricsCache();
      this.scheduleSave();
    }

    return inserted;
  }

  insertTopicMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    let inserted = 0;
    const stmt = this.db.prepare(
      `INSERT INTO topic_messages (
        topic_id,
        sequence_number,
        message_base64,
        message_utf8,
        payer_account_id,
        tx_id,
        consensus_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMany = this.db.transaction((items) => {
      for (const message of items) {
        try {
          const sequenceNumber = Number.isFinite(message.sequence_number)
            ? Number(message.sequence_number)
            : Number.parseInt(message.sequence_number, 10);
          const result = stmt.run(
            message.topic_id,
            Number.isFinite(sequenceNumber) ? sequenceNumber : null,
            message.message_base64 || null,
            message.message_utf8 || null,
            message.payer_account_id || null,
            message.tx_id || null,
            message.consensus_timestamp
          );
          inserted += Number(result.changes || 0);
        } catch (error) {
          if (isUniqueConstraintError(error)) continue;
          throw error;
        }
      }
    });

    insertMany.immediate(messages);

    if (inserted > 0) {
      this.invalidateMetricsCache();
      this.scheduleSave();
    }

    return inserted;
  }

  getSyncState(entityId) {
    return this.queryOne(`SELECT * FROM sync_state WHERE entity_id = ?`, [entityId]);
  }

  updateSyncState(entityId, entityType, options = {}) {
    const { lastTimestamp, lastIndex, lastTxId, incrementBy = 0 } = options;
    const existing = this.getSyncState(entityId);

    if (existing) {
      this.runStatement(
        `UPDATE sync_state
         SET
           entity_type = ?,
           last_timestamp = ?,
           last_tx_id = ?,
           last_index = ?,
           items_synced = items_synced + ?,
           updated_at = datetime('now')
         WHERE entity_id = ?`,
        [
          entityType,
          lastTimestamp ?? existing.last_timestamp,
          lastTxId ?? existing.last_tx_id,
          lastIndex ?? existing.last_index,
          incrementBy,
          entityId,
        ]
      );
    } else {
      this.runStatement(
        `INSERT INTO sync_state (entity_id, entity_type, last_timestamp, last_tx_id, last_index, items_synced)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          entityId,
          entityType,
          lastTimestamp || '0.0',
          lastTxId || null,
          Number.isFinite(lastIndex) ? lastIndex : -1,
          incrementBy,
        ]
      );
    }

    this.scheduleSave();
  }

  getAllSyncStates() {
    return this.queryAll(`
      SELECT
        s.entity_id,
        s.entity_type,
        s.last_timestamp,
        s.last_tx_id,
        s.last_index,
        s.items_synced,
        s.updated_at,
        c.name,
        c.canonical_name,
        c.category,
        c.evm_address,
        c.source_file
      FROM sync_state s
      LEFT JOIN contracts c ON c.contract_id = s.entity_id
      ORDER BY s.items_synced DESC, s.updated_at DESC
    `);
  }

  updateStat(key, value) {
    this.runStatement(
      `INSERT INTO stats (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key)
       DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, String(value)]
    );
    this.scheduleSave();
  }

  getAllStats() {
    const rows = this.queryAll(`SELECT key, value FROM stats`);
    const stats = {};
    for (const row of rows) {
      stats[row.key] = row.value;
    }
    return stats;
  }

  toAgentRecord(baseRow) {
    if (!baseRow) return null;
    const record = {
      id: String(baseRow.id),
      name: String(baseRow.name || ''),
      type: String(baseRow.type || ''),
      network: String(baseRow.network || ''),
      model_provider: String(baseRow.model_provider || ''),
      model_name: String(baseRow.model_name || ''),
      system_prompt: String(baseRow.system_prompt || ''),
      topics: parseJsonText(baseRow.topics_json, []),
      post_examples: parseJsonText(baseRow.post_examples_json, []),
      semantic_scope: parseJsonText(baseRow.semantic_scope_json, {}),
      tool_allowlist: parseJsonText(baseRow.tool_allowlist_json, []),
      publish_targets: parseJsonText(baseRow.publish_targets_json, {}),
      schedule: parseJsonText(baseRow.schedule_json, {}),
      env_refs: parseJsonText(baseRow.env_refs_json, []),
      runtime_status: String(baseRow.runtime_status || 'stopped'),
      last_run_summary: parseJsonText(baseRow.last_run_summary_json, null),
      created_at: baseRow.created_at || null,
      updated_at: baseRow.updated_at || null,
      run_count: Number(baseRow.run_count || 0),
      event_count: Number(baseRow.event_count || 0),
      last_run_at: baseRow.last_run_at || null,
    };

    record.tool_configs = this.getAgentToolConfigs(record.id);
    record.env_refs = this.getAgentEnvRefs(record.id);
    record.schedules = this.getAgentSchedules(record.id);
    record.topic_registrations = this.getAgentTopicRegistrations(record.id);
    return record;
  }

  getAgentToolConfigs(agentId) {
    const rows = this.queryAll(
      `SELECT tool_key, enabled, config_json, updated_at
       FROM agent_tool_configs
       WHERE agent_id = ?
       ORDER BY tool_key ASC`,
      [agentId]
    );
    return rows.map((row) => ({
      tool_key: String(row.tool_key),
      enabled: Number(row.enabled) === 1,
      config: parseJsonText(row.config_json, {}),
      updated_at: row.updated_at || null,
    }));
  }

  getAgentEnvRefs(agentId) {
    const rows = this.queryAll(
      `SELECT ref_key, env_var_name, required, description, updated_at
       FROM agent_env_refs
       WHERE agent_id = ?
       ORDER BY ref_key ASC`,
      [agentId]
    );
    return rows.map((row) => ({
      key: String(row.ref_key),
      env_var_name: String(row.env_var_name),
      required: Number(row.required) === 1,
      description: row.description || '',
      updated_at: row.updated_at || null,
    }));
  }

  getAgentSchedules(agentId) {
    const rows = this.queryAll(
      `SELECT schedule_key, cron_expr, enabled, timezone, config_json, updated_at
       FROM agent_schedules
       WHERE agent_id = ?
       ORDER BY schedule_key ASC`,
      [agentId]
    );
    return rows.map((row) => ({
      schedule_key: String(row.schedule_key),
      cron: row.cron_expr || '',
      enabled: Number(row.enabled) === 1,
      timezone: row.timezone || 'UTC',
      config: parseJsonText(row.config_json, {}),
      updated_at: row.updated_at || null,
    }));
  }

  getAgentTopicRegistrations(agentId) {
    const rows = this.queryAll(
      `SELECT agent_id, network, topic_id, label, created_at
       FROM agent_topic_registrations
       WHERE agent_id = ?
       ORDER BY created_at DESC, id DESC`,
      [agentId]
    );
    return rows.map((row) => ({
      agent_id: String(row.agent_id),
      network: String(row.network),
      topic_id: String(row.topic_id),
      label: row.label || null,
      created_at: row.created_at || null,
    }));
  }

  getAllAgentTopicRegistrations() {
    const rows = this.queryAll(
      `SELECT agent_id, network, topic_id, label, created_at
       FROM agent_topic_registrations
       ORDER BY created_at DESC, id DESC`
    );
    return rows.map((row) => ({
      agent_id: String(row.agent_id),
      network: String(row.network),
      topic_id: String(row.topic_id),
      label: row.label || null,
      created_at: row.created_at || null,
    }));
  }

  listAgents() {
    const rows = this.queryAll(`
      SELECT
        a.*,
        COALESCE(r.run_count, 0) AS run_count,
        r.last_run_at AS last_run_at,
        COALESCE(e.event_count, 0) AS event_count
      FROM agents a
      LEFT JOIN (
        SELECT agent_id, COUNT(*) AS run_count, MAX(started_at) AS last_run_at
        FROM agent_runs
        GROUP BY agent_id
      ) r ON r.agent_id = a.id
      LEFT JOIN (
        SELECT agent_id, COUNT(*) AS event_count
        FROM agent_events
        GROUP BY agent_id
      ) e ON e.agent_id = a.id
      ORDER BY a.updated_at DESC, a.created_at DESC, a.id ASC
    `);
    return rows.map((row) => this.toAgentRecord(row));
  }

  getAgentById(agentId) {
    const row = this.queryOne(
      `SELECT
        a.*,
        COALESCE(r.run_count, 0) AS run_count,
        r.last_run_at AS last_run_at,
        COALESCE(e.event_count, 0) AS event_count
       FROM agents a
       LEFT JOIN (
         SELECT agent_id, COUNT(*) AS run_count, MAX(started_at) AS last_run_at
         FROM agent_runs
         GROUP BY agent_id
       ) r ON r.agent_id = a.id
       LEFT JOIN (
         SELECT agent_id, COUNT(*) AS event_count
         FROM agent_events
         GROUP BY agent_id
       ) e ON e.agent_id = a.id
       WHERE a.id = ?
       LIMIT 1`,
      [agentId]
    );
    return this.toAgentRecord(row);
  }

  replaceAgentToolConfigs(agentId, tools) {
    this.runStatement(`DELETE FROM agent_tool_configs WHERE agent_id = ?`, [agentId]);
    const list = Array.isArray(tools) ? tools : [];
    const insertStmt = this.db.prepare(
      `INSERT INTO agent_tool_configs (agent_id, tool_key, enabled, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    );
    const insertMany = this.db.transaction((items) => {
      for (const item of items) {
        const toolKey = typeof item === 'string' ? item : String(item?.tool_key || '');
        if (!toolKey) continue;
        const enabled = typeof item === 'string' ? 1 : item?.enabled === false ? 0 : 1;
        const configJson = typeof item === 'string' ? '{}' : JSON.stringify(item?.config || {});
        insertStmt.run(agentId, toolKey, enabled, configJson);
      }
    });
    insertMany.immediate(list);
  }

  replaceAgentEnvRefs(agentId, refs) {
    this.runStatement(`DELETE FROM agent_env_refs WHERE agent_id = ?`, [agentId]);
    const list = Array.isArray(refs) ? refs : [];
    const insertStmt = this.db.prepare(
      `INSERT INTO agent_env_refs (agent_id, ref_key, env_var_name, required, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );
    const insertMany = this.db.transaction((items) => {
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const key = String(item.key || '').trim();
        const envVarName = String(item.env_var_name || '').trim();
        if (!key || !envVarName) continue;
        const required = item.required === false ? 0 : 1;
        const description = String(item.description || '').trim();
        insertStmt.run(agentId, key, envVarName, required, description || null);
      }
    });
    insertMany.immediate(list);
  }

  replaceAgentSchedules(agentId, schedule) {
    this.runStatement(`DELETE FROM agent_schedules WHERE agent_id = ?`, [agentId]);
    const entries = [];
    if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
      entries.push({
        schedule_key: 'default',
        cron: schedule.cron || '',
        enabled: schedule.enabled === true,
        timezone: schedule.timezone || 'UTC',
        config: schedule,
      });
    } else if (Array.isArray(schedule)) {
      for (const item of schedule) {
        if (!item || typeof item !== 'object') continue;
        entries.push({
          schedule_key: item.schedule_key || item.key || 'default',
          cron: item.cron || '',
          enabled: item.enabled === true,
          timezone: item.timezone || 'UTC',
          config: item,
        });
      }
    }

    const insertStmt = this.db.prepare(
      `INSERT INTO agent_schedules (agent_id, schedule_key, cron_expr, enabled, timezone, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );
    const insertMany = this.db.transaction((items) => {
      for (const item of items) {
        const key = String(item.schedule_key || '').trim();
        if (!key) continue;
        insertStmt.run(
          agentId,
          key,
          String(item.cron || ''),
          item.enabled ? 1 : 0,
          String(item.timezone || 'UTC'),
          JSON.stringify(item.config || {})
        );
      }
    });
    insertMany.immediate(entries);
  }

  createAgent(agent) {
    const payload = {
      id: String(agent.id),
      name: String(agent.name || ''),
      type: String(agent.type || ''),
      network: String(agent.network || ''),
      model_provider: String(agent.model_provider || ''),
      model_name: String(agent.model_name || ''),
      system_prompt: String(agent.system_prompt || ''),
      topics: Array.isArray(agent.topics) ? agent.topics : [],
      post_examples: Array.isArray(agent.post_examples) ? agent.post_examples : [],
      semantic_scope: agent.semantic_scope && typeof agent.semantic_scope === 'object' ? agent.semantic_scope : {},
      tool_allowlist: Array.isArray(agent.tool_allowlist) ? agent.tool_allowlist : [],
      publish_targets: agent.publish_targets && typeof agent.publish_targets === 'object' ? agent.publish_targets : {},
      schedule: agent.schedule && typeof agent.schedule === 'object' ? agent.schedule : {},
      env_refs: Array.isArray(agent.env_refs) ? agent.env_refs : [],
      runtime_status: String(agent.runtime_status || 'stopped'),
      last_run_summary: agent.last_run_summary || null,
    };

    this.runStatement(
      `INSERT INTO agents (
        id,
        name,
        type,
        network,
        model_provider,
        model_name,
        system_prompt,
        topics_json,
        post_examples_json,
        semantic_scope_json,
        tool_allowlist_json,
        publish_targets_json,
        schedule_json,
        env_refs_json,
        runtime_status,
        last_run_summary_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        payload.id,
        payload.name,
        payload.type,
        payload.network,
        payload.model_provider,
        payload.model_name,
        payload.system_prompt,
        JSON.stringify(payload.topics),
        JSON.stringify(payload.post_examples),
        JSON.stringify(payload.semantic_scope),
        JSON.stringify(payload.tool_allowlist),
        JSON.stringify(payload.publish_targets),
        JSON.stringify(payload.schedule),
        JSON.stringify(payload.env_refs),
        payload.runtime_status,
        payload.last_run_summary ? JSON.stringify(payload.last_run_summary) : null,
      ]
    );

    this.replaceAgentToolConfigs(payload.id, payload.tool_allowlist);
    this.replaceAgentEnvRefs(payload.id, payload.env_refs);
    this.replaceAgentSchedules(payload.id, payload.schedule);
    this.scheduleSave();
    return this.getAgentById(payload.id);
  }

  updateAgent(agentId, patch = {}) {
    const existing = this.getAgentById(agentId);
    if (!existing) {
      const error = new Error(`Agent not found: ${agentId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    const next = {
      name: patch.name !== undefined ? String(patch.name) : existing.name,
      network: patch.network !== undefined ? String(patch.network) : existing.network,
      model_provider: patch.model_provider !== undefined ? String(patch.model_provider) : existing.model_provider,
      model_name: patch.model_name !== undefined ? String(patch.model_name) : existing.model_name,
      system_prompt: patch.system_prompt !== undefined ? String(patch.system_prompt) : existing.system_prompt,
      topics: patch.topics !== undefined ? (Array.isArray(patch.topics) ? patch.topics : []) : existing.topics,
      post_examples:
        patch.post_examples !== undefined ? (Array.isArray(patch.post_examples) ? patch.post_examples : []) : existing.post_examples,
      semantic_scope:
        patch.semantic_scope !== undefined && patch.semantic_scope && typeof patch.semantic_scope === 'object'
          ? patch.semantic_scope
          : existing.semantic_scope,
      tool_allowlist:
        patch.tool_allowlist !== undefined
          ? (Array.isArray(patch.tool_allowlist) ? patch.tool_allowlist : [])
          : existing.tool_allowlist,
      publish_targets:
        patch.publish_targets !== undefined && patch.publish_targets && typeof patch.publish_targets === 'object'
          ? patch.publish_targets
          : existing.publish_targets,
      schedule:
        patch.schedule !== undefined && patch.schedule && typeof patch.schedule === 'object'
          ? patch.schedule
          : existing.schedule,
      env_refs: patch.env_refs !== undefined ? (Array.isArray(patch.env_refs) ? patch.env_refs : []) : existing.env_refs,
      runtime_status: patch.runtime_status !== undefined ? String(patch.runtime_status) : existing.runtime_status,
      last_run_summary: patch.last_run_summary !== undefined ? patch.last_run_summary : existing.last_run_summary,
    };

    this.runStatement(
      `UPDATE agents
       SET
         name = ?,
         network = ?,
         model_provider = ?,
         model_name = ?,
         system_prompt = ?,
         topics_json = ?,
         post_examples_json = ?,
         semantic_scope_json = ?,
         tool_allowlist_json = ?,
         publish_targets_json = ?,
         schedule_json = ?,
         env_refs_json = ?,
         runtime_status = ?,
         last_run_summary_json = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        next.name,
        next.network,
        next.model_provider,
        next.model_name,
        next.system_prompt,
        JSON.stringify(next.topics),
        JSON.stringify(next.post_examples),
        JSON.stringify(next.semantic_scope),
        JSON.stringify(next.tool_allowlist),
        JSON.stringify(next.publish_targets),
        JSON.stringify(next.schedule),
        JSON.stringify(next.env_refs),
        next.runtime_status,
        next.last_run_summary ? JSON.stringify(next.last_run_summary) : null,
        agentId,
      ]
    );

    this.replaceAgentToolConfigs(agentId, next.tool_allowlist);
    this.replaceAgentEnvRefs(agentId, next.env_refs);
    this.replaceAgentSchedules(agentId, next.schedule);
    this.scheduleSave();
    return this.getAgentById(agentId);
  }

  setAgentRuntimeStatus(agentId, runtimeStatus, lastRunSummary = null) {
    return this.updateAgent(agentId, {
      runtime_status: runtimeStatus,
      last_run_summary: lastRunSummary,
    });
  }

  deleteAgent(agentId) {
    const existing = this.getAgentById(agentId);
    if (!existing) {
      const error = new Error(`Agent not found: ${agentId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }
    this.runStatement(`DELETE FROM agents WHERE id = ?`, [agentId]);
    this.scheduleSave();
    return true;
  }

  createAgentRun(run) {
    this.runStatement(
      `INSERT INTO agent_runs (
        id,
        agent_id,
        status,
        mode,
        trigger_source,
        summary,
        details_json,
        started_at,
        finished_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        String(run.id),
        String(run.agent_id),
        String(run.status || 'running'),
        String(run.mode || 'manual'),
        String(run.trigger_source || 'manual'),
        String(run.summary || ''),
        run.details ? JSON.stringify(run.details) : null,
        normalizeIsoDate(run.started_at, new Date().toISOString()),
        normalizeIsoDate(run.finished_at, null),
      ]
    );
    this.scheduleSave();
  }

  finishAgentRun(runId, values = {}) {
    this.runStatement(
      `UPDATE agent_runs
       SET
         status = ?,
         summary = ?,
         details_json = ?,
         finished_at = ?
       WHERE id = ?`,
      [
        String(values.status || 'success'),
        String(values.summary || ''),
        values.details ? JSON.stringify(values.details) : null,
        normalizeIsoDate(values.finished_at, new Date().toISOString()),
        String(runId),
      ]
    );
    this.scheduleSave();
  }

  getAgentRuns(agentId, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const rows = this.queryAll(
      `SELECT id, agent_id, status, mode, trigger_source, summary, details_json, started_at, finished_at, created_at
       FROM agent_runs
       WHERE agent_id = ?
       ORDER BY started_at DESC, created_at DESC, id DESC
       LIMIT ?`,
      [agentId, safeLimit]
    );
    return rows.map((row) => ({
      id: String(row.id),
      agent_id: String(row.agent_id),
      status: String(row.status),
      mode: String(row.mode),
      trigger_source: String(row.trigger_source),
      summary: String(row.summary || ''),
      details: parseJsonText(row.details_json, null),
      started_at: row.started_at || null,
      finished_at: row.finished_at || null,
      created_at: row.created_at || null,
    }));
  }

  createAgentEvent(event) {
    this.runStatement(
      `INSERT INTO agent_events (agent_id, run_id, event_type, level, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        String(event.agent_id),
        event.run_id ? String(event.run_id) : null,
        String(event.event_type || 'event'),
        String(event.level || 'info'),
        String(event.message || ''),
        event.payload ? JSON.stringify(event.payload) : null,
      ]
    );
    this.scheduleSave();
  }

  getAgentEvents(agentId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const rows = this.queryAll(
      `SELECT id, agent_id, run_id, event_type, level, message, payload_json, created_at
       FROM agent_events
       WHERE agent_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [agentId, safeLimit]
    );
    return rows.map((row) => ({
      id: Number(row.id),
      agent_id: String(row.agent_id),
      run_id: row.run_id ? String(row.run_id) : null,
      event_type: String(row.event_type),
      level: String(row.level || 'info'),
      message: String(row.message || ''),
      payload: parseJsonText(row.payload_json, null),
      created_at: row.created_at || null,
    }));
  }

  toAgentChatSessionRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      agent_id: String(row.agent_id || ''),
      title: row.title ? String(row.title) : null,
      mode: String(row.mode || 'stateful'),
      metadata: parseJsonText(row.metadata_json, {}),
      auto_execute: Number(row.auto_execute || 0) === 1,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      last_message_at: row.last_message_at || null,
    };
  }

  toAgentChatMessageRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      session_id: String(row.session_id || ''),
      role: String(row.role || 'assistant'),
      content: String(row.content || ''),
      payload: parseJsonText(row.payload_json, {}),
      status: String(row.status || 'completed'),
      created_at: row.created_at || null,
    };
  }

  toAgentChatEventRecord(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      session_id: String(row.session_id || ''),
      message_id: row.message_id ? String(row.message_id) : null,
      event_type: String(row.event_type || 'event'),
      level: String(row.level || 'info'),
      payload: parseJsonText(row.payload_json, {}),
      created_at: row.created_at || null,
    };
  }

  createAgentChatSession(session) {
    const payload = {
      id: String(session.id || crypto.randomUUID()),
      agent_id: String(session.agent_id || ''),
      title: session.title == null ? null : String(session.title || ''),
      mode: String(session.mode || 'stateful'),
      metadata: session.metadata && typeof session.metadata === 'object' ? session.metadata : {},
      auto_execute: session.auto_execute === false ? 0 : 1,
    };

    this.runStatement(
      `INSERT INTO agent_chat_sessions (
         id,
         agent_id,
         title,
         mode,
         metadata_json,
         auto_execute,
         created_at,
         updated_at,
         last_message_at
       ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), null)`,
      [
        payload.id,
        payload.agent_id,
        payload.title,
        payload.mode,
        JSON.stringify(payload.metadata),
        payload.auto_execute,
      ]
    );
    this.scheduleSave();
    return this.getAgentChatSessionById(payload.id);
  }

  getAgentChatSessionById(sessionId) {
    const row = this.queryOne(
      `SELECT id, agent_id, title, mode, metadata_json, auto_execute, created_at, updated_at, last_message_at
       FROM agent_chat_sessions
       WHERE id = ?
       LIMIT 1`,
      [String(sessionId || '')]
    );
    return this.toAgentChatSessionRecord(row);
  }

  listAgentChatSessions(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const rows = this.queryAll(
      `SELECT id, agent_id, title, mode, metadata_json, auto_execute, created_at, updated_at, last_message_at
       FROM agent_chat_sessions
       ORDER BY COALESCE(last_message_at, updated_at) DESC, created_at DESC, id ASC
       LIMIT ?`,
      [safeLimit]
    );
    return rows.map((row) => this.toAgentChatSessionRecord(row));
  }

  createAgentChatMessage(message) {
    const payload = {
      id: String(message.id || crypto.randomUUID()),
      session_id: String(message.session_id || ''),
      role: String(message.role || 'assistant'),
      content: String(message.content || ''),
      payload: message.payload && typeof message.payload === 'object' ? message.payload : {},
      status: String(message.status || 'completed'),
    };

    this.runStatement(
      `INSERT INTO agent_chat_messages (
         id,
         session_id,
         role,
         content,
         payload_json,
         status,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        payload.id,
        payload.session_id,
        payload.role,
        payload.content,
        JSON.stringify(payload.payload),
        payload.status,
      ]
    );

    this.runStatement(
      `UPDATE agent_chat_sessions
       SET
         updated_at = datetime('now'),
         last_message_at = datetime('now')
       WHERE id = ?`,
      [payload.session_id]
    );

    this.scheduleSave();
    return this.getAgentChatMessageById(payload.id);
  }

  getAgentChatMessageById(messageId) {
    const row = this.queryOne(
      `SELECT id, session_id, role, content, payload_json, status, created_at
       FROM agent_chat_messages
       WHERE id = ?
       LIMIT 1`,
      [String(messageId || '')]
    );
    return this.toAgentChatMessageRecord(row);
  }

  listAgentChatMessages(sessionId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const rows = this.queryAll(
      `SELECT id, session_id, role, content, payload_json, status, created_at
       FROM agent_chat_messages
       WHERE session_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [String(sessionId || ''), safeLimit]
    );
    return rows.map((row) => this.toAgentChatMessageRecord(row));
  }

  createAgentChatEvent(event) {
    this.runStatement(
      `INSERT INTO agent_chat_events (
         session_id,
         message_id,
         event_type,
         level,
         payload_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [
        String(event.session_id || ''),
        event.message_id ? String(event.message_id) : null,
        String(event.event_type || 'event'),
        String(event.level || 'info'),
        JSON.stringify(event.payload && typeof event.payload === 'object' ? event.payload : {}),
      ]
    );
    const row = this.queryOne(
      `SELECT id, session_id, message_id, event_type, level, payload_json, created_at
       FROM agent_chat_events
       ORDER BY id DESC
       LIMIT 1`
    );
    this.scheduleSave();
    return this.toAgentChatEventRecord(row);
  }

  listAgentChatEvents(sessionId, limit = 200) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
    const rows = this.queryAll(
      `SELECT id, session_id, message_id, event_type, level, payload_json, created_at
       FROM agent_chat_events
       WHERE session_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [String(sessionId || ''), safeLimit]
    );
    return rows.map((row) => this.toAgentChatEventRecord(row));
  }

  upsertAgentTopicRegistration(registration) {
    const agentId = String(registration.agent_id || '').trim();
    const network = String(registration.network || '').trim();
    const topicId = String(registration.topic_id || '').trim();
    if (!agentId || !network || !topicId) {
      const error = new Error('agent_id, network, and topic_id are required');
      error.code = 'INVALID_AGENT_TOPIC';
      throw error;
    }
    this.runStatement(
      `INSERT INTO agent_topic_registrations (agent_id, network, topic_id, label, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id, network, topic_id) DO UPDATE SET label = excluded.label`,
      [agentId, network, topicId, registration.label ? String(registration.label) : null]
    );
    this.scheduleSave();
    return {
      agent_id: agentId,
      network,
      topic_id: topicId,
      label: registration.label ? String(registration.label) : null,
    };
  }

  toAiModelDraftRecord(row) {
    if (!row) return null;
    return {
      draft_id: String(row.id),
      intent_text: String(row.intent_text || ''),
      constraints_text: row.constraints_text ? String(row.constraints_text) : '',
      target_path: String(row.target_path || ''),
      generated_yaml: String(row.generated_yaml || ''),
      rationale: row.rationale ? String(row.rationale) : '',
      warnings: parseJsonText(row.warnings_json, []),
      validation: parseJsonText(row.validation_json, {}),
      context_hash: String(row.context_hash || ''),
      llm_model: row.llm_model ? String(row.llm_model) : null,
      status: String(row.status || 'draft'),
      approved_path: row.approved_path ? String(row.approved_path) : null,
      created_at: row.created_at || null,
      approved_at: row.approved_at || null,
    };
  }

  createAiModelDraft(draft) {
    const draftId = String(draft.draft_id || crypto.randomUUID());
    this.runStatement(
      `INSERT INTO ai_model_drafts (
        id,
        intent_text,
        constraints_text,
        target_path,
        generated_yaml,
        rationale,
        warnings_json,
        validation_json,
        context_hash,
        llm_model,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', datetime('now'))`,
      [
        draftId,
        String(draft.intent_text || ''),
        draft.constraints_text ? String(draft.constraints_text) : null,
        String(draft.target_path || ''),
        String(draft.generated_yaml || ''),
        draft.rationale ? String(draft.rationale) : null,
        JSON.stringify(Array.isArray(draft.warnings) ? draft.warnings : []),
        JSON.stringify(draft.validation && typeof draft.validation === 'object' ? draft.validation : {}),
        String(draft.context_hash || ''),
        draft.llm_model ? String(draft.llm_model) : null,
      ]
    );
    this.scheduleSave();
    return this.getAiModelDraft(draftId);
  }

  getAiModelDraft(draftId) {
    const row = this.queryOne(`SELECT * FROM ai_model_drafts WHERE id = ? LIMIT 1`, [String(draftId)]);
    return this.toAiModelDraftRecord(row);
  }

  approveAiModelDraft(draftId, approvedPath) {
    const existing = this.getAiModelDraft(draftId);
    if (!existing) {
      const error = new Error(`Draft not found: ${draftId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }
    this.runStatement(
      `UPDATE ai_model_drafts
       SET status = 'approved',
           approved_path = ?,
           approved_at = datetime('now')
       WHERE id = ?`,
      [String(approvedPath || ''), String(draftId)]
    );
    this.scheduleSave();
    return this.getAiModelDraft(draftId);
  }

  toApiEndpointRecord(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name || ''),
      slug: String(row.slug || ''),
      description: row.description ? String(row.description) : '',
      enabled: Number(row.enabled) === 1,
      query_template: parseJsonText(row.query_template_json, {}),
      params_schema: parseJsonText(row.params_schema_json, []),
      last_run_at: row.last_run_at || null,
      last_run_status: row.last_run_status || null,
      last_run_error: row.last_run_error || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    };
  }

  listApiEndpoints() {
    const rows = this.queryAll(
      `SELECT *
       FROM api_endpoints
       ORDER BY updated_at DESC, created_at DESC, id ASC`
    );
    return rows.map((row) => this.toApiEndpointRecord(row));
  }

  getApiEndpointById(endpointId) {
    const row = this.queryOne(`SELECT * FROM api_endpoints WHERE id = ? LIMIT 1`, [String(endpointId)]);
    return this.toApiEndpointRecord(row);
  }

  getApiEndpointBySlug(slug) {
    const row = this.queryOne(`SELECT * FROM api_endpoints WHERE slug = ? LIMIT 1`, [String(slug)]);
    return this.toApiEndpointRecord(row);
  }

  createApiEndpoint(endpoint) {
    const id = String(endpoint.id || crypto.randomUUID());
    this.runStatement(
      `INSERT INTO api_endpoints (
        id,
        name,
        slug,
        description,
        enabled,
        query_template_json,
        params_schema_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        id,
        String(endpoint.name || ''),
        String(endpoint.slug || ''),
        endpoint.description ? String(endpoint.description) : null,
        endpoint.enabled === false ? 0 : 1,
        JSON.stringify(endpoint.query_template && typeof endpoint.query_template === 'object' ? endpoint.query_template : {}),
        JSON.stringify(Array.isArray(endpoint.params_schema) ? endpoint.params_schema : []),
      ]
    );
    this.scheduleSave();
    return this.getApiEndpointById(id);
  }

  updateApiEndpoint(endpointId, patch = {}) {
    const existing = this.getApiEndpointById(endpointId);
    if (!existing) {
      const error = new Error(`API endpoint not found: ${endpointId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    const next = {
      name: patch.name !== undefined ? String(patch.name) : existing.name,
      slug: patch.slug !== undefined ? String(patch.slug) : existing.slug,
      description: patch.description !== undefined ? String(patch.description) : existing.description,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled,
      query_template:
        patch.query_template !== undefined && patch.query_template && typeof patch.query_template === 'object'
          ? patch.query_template
          : existing.query_template,
      params_schema: patch.params_schema !== undefined ? (Array.isArray(patch.params_schema) ? patch.params_schema : []) : existing.params_schema,
    };

    this.runStatement(
      `UPDATE api_endpoints
       SET
         name = ?,
         slug = ?,
         description = ?,
         enabled = ?,
         query_template_json = ?,
         params_schema_json = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        next.name,
        next.slug,
        next.description || null,
        next.enabled ? 1 : 0,
        JSON.stringify(next.query_template),
        JSON.stringify(next.params_schema),
        String(endpointId),
      ]
    );
    this.scheduleSave();
    return this.getApiEndpointById(endpointId);
  }

  deleteApiEndpoint(endpointId) {
    const existing = this.getApiEndpointById(endpointId);
    if (!existing) {
      const error = new Error(`API endpoint not found: ${endpointId}`);
      error.code = 'NOT_FOUND';
      throw error;
    }

    this.runStatement(`DELETE FROM api_endpoints WHERE id = ?`, [String(endpointId)]);
    this.scheduleSave();
    return true;
  }

  recordApiEndpointRun(endpointId, status, errorMessage = null) {
    this.runStatement(
      `UPDATE api_endpoints
       SET
         last_run_at = datetime('now'),
         last_run_status = ?,
         last_run_error = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        String(status || 'unknown'),
        errorMessage ? String(errorMessage) : null,
        String(endpointId),
      ]
    );
    this.scheduleSave();
  }

  logActivity(eventType, entityName, message) {
    this.runStatement(`INSERT INTO activity_log (event_type, entity_name, message) VALUES (?, ?, ?)`, [
      eventType,
      entityName || null,
      message,
    ]);
    this.scheduleSave();
  }

  logIngestError({ source, entityType, entityId = null, reason, payload = null }) {
    const sourceValue = String(source || '').trim() || 'indexer';
    const entityTypeValue = String(entityType || '').trim() || 'unknown';
    const entityIdValue = entityId == null ? null : String(entityId).trim();
    const reasonValue = String(reason || '').trim() || 'unspecified ingest error';
    const payloadJson = payload == null ? null : JSON.stringify(payload);
    const payloadHash = crypto
      .createHash('sha256')
      .update(`${sourceValue}|${entityTypeValue}|${entityIdValue || ''}|${reasonValue}|${payloadJson || ''}`)
      .digest('hex');

    this.runStatement(
      `INSERT OR IGNORE INTO ingest_errors (source, entity_type, entity_id, reason, payload_hash, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sourceValue, entityTypeValue, entityIdValue, reasonValue, payloadHash, payloadJson]
    );
    this.scheduleSave();
  }

  getDatabaseInfo() {
    const sizeBytes = this.getDbSizeBytes();
    const contractLogs = this.queryOne(`SELECT COUNT(*) AS count FROM contract_logs`)?.count || 0;
    const htsTransfers = this.queryOne(`SELECT COUNT(*) AS count FROM hts_transfers`)?.count || 0;
    const erc20Transfers = this.queryOne(`SELECT COUNT(*) AS count FROM erc20_transfers`)?.count || 0;
    const topicMessages = this.queryOne(`SELECT COUNT(*) AS count FROM topic_messages`)?.count || 0;
    const contracts = this.queryOne(`SELECT COUNT(*) AS count FROM contracts`)?.count || 0;

    return {
      size_bytes: sizeBytes,
      size_mb: Number((sizeBytes / 1024 / 1024).toFixed(2)),
      size_gb: Number((sizeBytes / 1024 / 1024 / 1024).toFixed(4)),
      usage_percent: Number(((sizeBytes / this.config.maxDbSizeBytes) * 100).toFixed(2)),
      max_size_bytes: this.config.maxDbSizeBytes,
      total_contract_logs: contractLogs,
      total_hts_transfers: htsTransfers,
      total_erc20_transfers: erc20Transfers,
      total_topic_messages: topicMessages,
      total_contracts: contracts,
      is_full: this.isDatabaseFull(),
      live_db_path: this.config.dbPath,
      cube_db_path: this.config.cubeDbPath,
      journal_mode: 'wal',
    };
  }

  getPersistenceStatus() {
    const intervalMs = this.getEffectiveSaveIntervalMs();
    return {
      is_saving: this.isSaving,
      last_save_at: this.lastSaveAt,
      last_save_duration_ms: this.lastSaveDurationMs,
      last_save_error: this.lastSaveError,
      effective_save_interval_ms: intervalMs,
      effective_save_debounce_ms: this.getEffectiveSaveDebounceMs(intervalMs),
      mode: 'live_sqlite_with_cube_snapshot',
      live_db_path: this.config.dbPath,
      cube_db_path: this.config.cubeDbPath,
      journal_mode: 'wal',
      busy_timeout_ms: this.dbBusyTimeoutMs,
    };
  }

  getOverview() {
    const overview = this.getOverviewCached({ allowStale: true });
    return {
      database: overview.database,
      stats: overview.stats,
      records_indexed: overview.records_indexed,
    };
  }

  getStatusMetrics() {
    // Status endpoints are latency-sensitive and should avoid blocking on DB locks.
    // Prefer last-known cached metrics and report freshness via status_age_ms/source.
    const overview = this.getOverviewCached({ allowStale: true, preferCache: true });
    return {
      source: overview.source || 'cache',
      status_age_ms: overview.status_age_ms || 0,
      generated_at: overview.generated_at || null,
      database: overview.database,
      stats: overview.stats,
      records_indexed: overview.records_indexed,
    };
  }

  getRecentActivity(limit = 50) {
    return this.queryAll(`SELECT * FROM activity_log ORDER BY id DESC LIMIT ?`, [limit]);
  }

  getContractsProgress() {
    return this.queryAll(`
      SELECT
        c.contract_id,
        c.name,
        c.canonical_name,
        c.category,
        c.evm_address,
        c.asset,
        c.source_file,
        COALESCE(s.items_synced, 0) AS items_synced,
        COALESCE(s.last_timestamp, '0.0') AS last_timestamp,
        COALESCE(s.last_tx_id, '') AS last_tx_id,
        COALESCE(s.last_index, -1) AS last_index,
        s.updated_at
      FROM contracts c
      LEFT JOIN sync_state s ON s.entity_id = c.contract_id
      ORDER BY items_synced DESC, c.name ASC
    `);
  }

  getRecentRecords(type, limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));

    if (type === 'contract_logs') {
      return this.queryAll(
        `SELECT l.*, c.name AS contract_name
         FROM contract_logs l
         LEFT JOIN contracts c ON c.contract_id = l.contract_id
         ORDER BY l.timestamp DESC, l.id DESC
         LIMIT ?`,
        [safeLimit]
      );
    }

    if (type === 'hts_transfers') {
      return this.queryAll(
        `SELECT
           id,
           token_id,
           COALESCE(network, CASE WHEN instr(token_id, ':') > 0 THEN substr(token_id, 1, instr(token_id, ':') - 1) ELSE NULL END) AS network,
           account_id,
           amount_signed,
           amount_abs,
           tx_id,
           transfer_index,
           consensus_timestamp,
           consensus_timestamp AS timestamp,
           is_approval,
           indexed_at
         FROM hts_transfers
         ORDER BY consensus_timestamp DESC, id DESC
         LIMIT ?`,
        [safeLimit]
      );
    }

    if (type === 'erc20_transfers') {
      return this.queryAll(`SELECT * FROM erc20_transfers ORDER BY timestamp DESC, id DESC LIMIT ?`, [safeLimit]);
    }

    if (type === 'topic_messages') {
      return this.queryAll(
        `SELECT * FROM topic_messages ORDER BY consensus_timestamp DESC, id DESC LIMIT ?`,
        [safeLimit]
      );
    }

    throw new Error(`Unsupported record type: ${type}`);
  }

  getSqliteSchema() {
    const tables = this.queryAll(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `);

    return tables.map((table) => {
      const columns = this.queryAll(`PRAGMA table_info(${escapeIdentifier(table.name)})`).map((column) => ({
        cid: Number(column.cid),
        name: String(column.name),
        type: String(column.type || ''),
        notnull: Number(column.notnull) === 1,
        default_value: column.dflt_value ?? null,
        primary_key: Number(column.pk) === 1,
      }));

      return {
        name: String(table.name),
        sql: table.sql || '',
        columns,
      };
    });
  }

  executeReadOnlyQuery(sql, options = {}) {
    const maxRows = Math.max(1, Math.min(Number(options.maxRows) || 200, 2000));
    const maxExecutionMs = Math.max(250, Math.min(Number(options.maxExecutionMs) || 4000, 30000));
    const input = String(sql || '').trim();

    if (!input) {
      throw new Error('SQL query is required');
    }

    if (input.length > 20000) {
      throw new Error('SQL query is too long');
    }

    const queryWithoutTrailingSemicolon = input.endsWith(';')
      ? input.slice(0, input.length - 1).trim()
      : input;

    if (!queryWithoutTrailingSemicolon) {
      throw new Error('SQL query is required');
    }

    if (queryWithoutTrailingSemicolon.includes(';')) {
      throw new Error('Multiple SQL statements are not allowed');
    }

    const firstKeyword = queryWithoutTrailingSemicolon.split(/\s+/)[0].toLowerCase();
    const allowedKeywords = new Set(['select', 'with', 'explain']);
    if (!allowedKeywords.has(firstKeyword)) {
      throw new Error('Only read-only SELECT/WITH/EXPLAIN queries are allowed');
    }

    const forbiddenKeywords = /\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|vacuum|reindex|pragma)\b/i;
    if (forbiddenKeywords.test(queryWithoutTrailingSemicolon)) {
      throw new Error('Mutating SQL keywords are not allowed');
    }

    const startedAt = Date.now();
    try {
      const stmt = this.db.prepare(queryWithoutTrailingSemicolon);
      const columns = stmt.columns().map((column) => column.name);
      const rows = [];
      let totalRows = 0;
      let truncated = false;

      for (const row of stmt.iterate()) {
        totalRows += 1;
        if (rows.length < maxRows) {
          rows.push(row);
        } else {
          truncated = true;
          break;
        }

        if (Date.now() - startedAt > maxExecutionMs) {
          throw new Error(`SQL query exceeded ${maxExecutionMs}ms execution budget`);
        }
      }

      this.markReadSuccess(Date.now() - startedAt);

      return {
        columns,
        rows,
        total_rows: truncated ? maxRows + 1 : totalRows,
        returned_rows: rows.length,
        truncated,
        max_rows: maxRows,
        sql: queryWithoutTrailingSemicolon,
      };
    } catch (error) {
      this.markReadFailure(error, Date.now() - startedAt);
      throw error;
    }
  }

  async resetIndexerData() {
    const tables = [
      'contract_logs',
      'hts_transfers',
      'erc20_transfers',
      'topic_messages',
      'sync_state',
      'contracts',
      'activity_log',
      'ingest_errors',
      'external_source_runs',
      'external_source_records',
      'derived_pipeline_runs',
      'derived_pipeline_cursors',
      'derived_pipeline_contract_cursors',
      'clmm_pool_snapshots',
      'clmm_positions',
      'vault_strategy_state',
      'vault_actions_decoded',
      'price_volatility_snapshots',
      'clmm_agent_state',
      'agent_chat_events',
      'agent_chat_messages',
      'agent_chat_sessions',
    ];

    const resetTxn = this.db.transaction(() => {
      for (const table of tables) {
        this.db.exec(`DELETE FROM ${escapeIdentifier(table)}`);
      }
      this.db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map((table) => escapeSqlString(table)).join(',')})`);
    });

    resetTxn.immediate();
    this.invalidateMetricsCache();

    const defaultStats = [
      ['mode', 'idle'],
      ['total_api_calls', '0'],
      ['last_rate_limit', ''],
      ['last_sync_contract_logs', '0'],
      ['last_sync_hts_transfers', '0'],
      ['last_sync_topic_messages', '0'],
      ['sync_started_at', ''],
      ['listen_started_at', ''],
      ['manifests_loaded', '0'],
    ];

    this.runStatement(`DELETE FROM stats WHERE key IN (${defaultStats.map(([key]) => escapeSqlString(key)).join(',')})`);
    const statStmt = this.db.prepare(`INSERT OR IGNORE INTO stats (key, value) VALUES (?, ?)`);
    for (const [key, value] of defaultStats) {
      statStmt.run(key, value);
    }

    this.logActivity('reset', null, 'Indexer data reset');
    await this.forceSave();
    return { success: true };
  }

  async close() {
    if (!this.db) return;
    if (this.walCheckpointInterval) {
      clearInterval(this.walCheckpointInterval);
      this.walCheckpointInterval = null;
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    this.snapshotsEnabled = true;
    await this.forceSave();

    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore checkpoint failure during shutdown
    }

    this.db.close();
    this.db = null;
  }
}
