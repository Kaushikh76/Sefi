import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config.js';
import { SeFiDatabase } from '../src/database.js';
import { SeFiIndexer } from '../src/indexer.js';

function jsonResponse(payload, status = 200) {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
    async json() {
      return payload;
    },
  };
}

test('startSyncContracts indexes USDC_HBAR_Pool last', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-contract-order-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  fs.writeFileSync(path.join(manifestDir, 'example.json'), JSON.stringify({
    protocol: 'Ordering Protocol',
    network: 'testnet',
    contracts: [
      { id: '0.0.5001', name: 'RegularContract', category: 'core' },
      { id: '0.0.5002', name: 'USDC_HBAR_Pool', category: 'vault-dual-pool' },
      { id: '0.0.5003', name: 'PriorityContract', category: 'core', priority: true },
    ],
    tokens: [],
    topics: [],
  }, null, 2));

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const requestedContracts = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/api\/v1\/contracts\/([^/]+)\/results\/logs$/);

    if (match) {
      requestedContracts.push(match[1]);
      return jsonResponse({ logs: [], links: { next: null } });
    }

    throw new Error(`Unhandled URL in test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });
  const result = await indexer.startSyncContracts();

  assert.equal(result.success, true);
  assert.deepEqual(requestedContracts, ['0.0.5003', '0.0.5001', '0.0.5002']);

  await database.close();
});

test('startSync indexes data and remains idempotent across restarts', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-integration-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  fs.writeFileSync(path.join(manifestDir, 'example.json'), JSON.stringify({
    protocol: 'Integration Protocol',
    network: 'testnet',
    contracts: [{ id: '0.0.5005', name: 'Core', category: 'core', priority: true }],
    tokens: [{ id: '0.0.6006', name: 'Token' }],
    topics: [{ id: '0.0.7007', name: 'Events' }],
  }, null, 2));

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');

  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
    SEFI_LISTEN_DELAY_MS: '1000',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.pathname === '/api/v1/contracts/0.0.5005/results/logs') {
      const timestamp = parsed.searchParams.get('timestamp');

      if (timestamp === 'gt:0.0') {
        return jsonResponse({
          logs: [
            {
              transaction_hash: '0xlog-1',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000001111111111111111111111111111111111111111',
                '0x0000000000000000000000002222222222222222222222222222222222222222'
              ],
              data: '0x01',
              block_number: 1,
              index: 0,
              timestamp: '1000.000000001',
            }
          ],
          links: { next: null },
        });
      }

      if (timestamp === 'gte:1000.000000001') {
        return jsonResponse({ logs: [], links: { next: null } });
      }

      return jsonResponse({ logs: [], links: { next: null } });
    }

    if (parsed.pathname === '/api/v1/transactions') {
      const timestamp = parsed.searchParams.get('timestamp');

      if (timestamp === 'gt:0.0') {
        return jsonResponse({
          transactions: [
            {
              transaction_id: '0.0.10-1000-1',
              consensus_timestamp: '1001.000000001',
              token_transfers: [
                { token_id: '0.0.6006', account: '0.0.101', amount: -10, is_approval: false },
                { token_id: '0.0.6006', account: '0.0.102', amount: 10, is_approval: false }
              ]
            }
          ],
          links: { next: null },
        });
      }

      if (timestamp === 'gt:1001.000000001') {
        return jsonResponse({ transactions: [], links: { next: null } });
      }

      return jsonResponse({ transactions: [], links: { next: null } });
    }

    if (parsed.pathname === '/api/v1/topics/0.0.7007/messages') {
      const timestamp = parsed.searchParams.get('timestamp');

      if (timestamp === 'gt:0.0') {
        return jsonResponse({
          messages: [
            {
              sequence_number: 1,
              message: Buffer.from('hello topic').toString('base64'),
              payer_account_id: '0.0.101',
              chunk_info: { initial_transaction_id: '0.0.101-1002-1' },
              consensus_timestamp: '1002.000000001',
            }
          ],
          links: { next: null },
        });
      }

      if (timestamp === 'gt:1002.000000001') {
        return jsonResponse({ messages: [], links: { next: null } });
      }

      return jsonResponse({ messages: [], links: { next: null } });
    }

    throw new Error(`Unhandled URL in test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });

  const firstRun = await indexer.startSync();
  assert.equal(firstRun.success, true);
  assert.equal(firstRun.totals.contractLogs, 1);
  assert.equal(firstRun.totals.htsTransfers, 2);
  assert.equal(firstRun.totals.topicMessages, 1);

  const secondRun = await indexer.startSync();
  assert.equal(secondRun.success, true);
  assert.equal(secondRun.totals.contractLogs, 0);
  assert.equal(secondRun.totals.htsTransfers, 0);
  assert.equal(secondRun.totals.topicMessages, 0);

  const overview = database.getOverview();
  assert.equal(overview.database.total_contract_logs, 1);
  assert.equal(overview.database.total_hts_transfers, 2);
  assert.equal(overview.database.total_topic_messages, 1);
  assert.equal(overview.database.total_erc20_transfers, 1);

  await database.close();
});

test('contract log cursor resume does not skip later timestamps with lower log index', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-contract-cursor-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  fs.writeFileSync(path.join(manifestDir, 'cursor.json'), JSON.stringify({
    protocol: 'Cursor Protocol',
    network: 'testnet',
    contracts: [{ id: '0.0.7777', name: 'CursorContract', category: 'core', priority: true }],
    tokens: [],
    topics: [],
  }, null, 2));

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  let callCount = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/v1/contracts/0.0.7777/results/logs') {
      const timestamp = parsed.searchParams.get('timestamp');

      if (timestamp === 'gt:0.0') {
        return jsonResponse({
          logs: [
            {
              transaction_hash: '0xcursor-log-1',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000001111111111111111111111111111111111111111',
                '0x0000000000000000000000002222222222222222222222222222222222222222',
              ],
              data: '0x01',
              block_number: 10,
              index: 10,
              timestamp: '1000.000000001',
            },
          ],
          links: { next: null },
        });
      }

      if (timestamp === 'gte:1000.000000001') {
        callCount += 1;
        if (callCount === 1) {
          return jsonResponse({
            logs: [
              {
                transaction_hash: '0xcursor-log-1',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x0000000000000000000000001111111111111111111111111111111111111111',
                  '0x0000000000000000000000002222222222222222222222222222222222222222',
                ],
                data: '0x01',
                block_number: 10,
                index: 10,
                timestamp: '1000.000000001',
              },
              {
                transaction_hash: '0xcursor-log-2',
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  '0x0000000000000000000000003333333333333333333333333333333333333333',
                  '0x0000000000000000000000004444444444444444444444444444444444444444',
                ],
                data: '0x02',
                block_number: 11,
                index: 1,
                timestamp: '1001.000000001',
              },
            ],
            links: { next: null },
          });
        }
        return jsonResponse({ logs: [], links: { next: null } });
      }
    }

    if (parsed.pathname === '/api/v1/transactions') {
      return jsonResponse({ transactions: [], links: { next: null } });
    }

    if (parsed.pathname.includes('/api/v1/topics/')) {
      return jsonResponse({ messages: [], links: { next: null } });
    }

    throw new Error(`Unhandled URL in cursor resume test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });
  const firstRun = await indexer.startSyncContracts();
  assert.equal(firstRun.success, true);
  assert.equal(firstRun.totals.contractLogs, 1);

  const secondRun = await indexer.startSyncContracts();
  assert.equal(secondRun.success, true);
  assert.equal(secondRun.totals.contractLogs, 1);

  const logs = database.getRecentRecords('contract_logs', 10);
  assert.equal(logs.length, 2);

  await database.close();
});

test('startSync indexes both mainnet and testnet when SEFI_NETWORKS is configured', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-multinet-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  fs.writeFileSync(path.join(manifestDir, 'mainnet.json'), JSON.stringify({
    protocol: 'Mainnet Protocol',
    network: 'mainnet',
    contracts: [{ id: '0.0.9001', name: 'Main Contract', category: 'core', priority: true }],
    tokens: [],
    topics: [],
  }, null, 2));

  fs.writeFileSync(path.join(manifestDir, 'testnet.json'), JSON.stringify({
    protocol: 'Testnet Protocol',
    network: 'testnet',
    contracts: [{ id: '0.0.9002', name: 'Test Contract', category: 'core', priority: true }],
    tokens: [],
    topics: [],
  }, null, 2));

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
    SEFI_NETWORKS: 'mainnet,testnet',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.hostname === 'mainnet-public.mirrornode.hedera.com' && parsed.pathname === '/api/v1/contracts/0.0.9001/results/logs') {
      return jsonResponse({
        logs: [
          {
            transaction_hash: '0xmain-log-1',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
            ],
            data: '0x01',
            block_number: 1,
            index: 0,
            timestamp: '2000.000000001',
          },
        ],
        links: { next: null },
      });
    }

    if (parsed.hostname === 'testnet.mirrornode.hedera.com' && parsed.pathname === '/api/v1/contracts/0.0.9002/results/logs') {
      return jsonResponse({
        logs: [
          {
            transaction_hash: '0xtest-log-1',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
              '0x000000000000000000000000dddddddddddddddddddddddddddddddddddddddd'
            ],
            data: '0x01',
            block_number: 1,
            index: 0,
            timestamp: '3000.000000001',
          },
        ],
        links: { next: null },
      });
    }

    if (parsed.pathname === '/api/v1/transactions') {
      return jsonResponse({ transactions: [], links: { next: null } });
    }

    if (parsed.pathname.includes('/api/v1/topics/')) {
      return jsonResponse({ messages: [], links: { next: null } });
    }

    throw new Error(`Unhandled URL in multi-network test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });
  const result = await indexer.startSync();

  assert.equal(result.success, true);
  assert.equal(result.totals.contractLogs, 2);

  const manifests = indexer.getManifestSummary();
  assert.equal(manifests.loaded.length, 2);
  assert.equal(manifests.totals.contracts, 2);

  const contracts = database.getContractsProgress();
  assert.equal(contracts.some((item) => item.contract_id === 'mainnet:0.0.9001'), true);
  assert.equal(contracts.some((item) => item.contract_id === 'testnet:0.0.9002'), true);

  await database.close();
});

test('targeted sync methods run selected phases only', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-targeted-sync-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  fs.writeFileSync(path.join(manifestDir, 'targets.json'), JSON.stringify({
    protocol: 'Targeted Protocol',
    network: 'testnet',
    contracts: [{ id: '0.0.5005', name: 'Core', category: 'core', priority: true }],
    tokens: [{ id: '0.0.6006', name: 'Token' }],
    topics: [{ id: '0.0.7007', name: 'Events' }],
  }, null, 2));

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  let contractCalls = 0;
  let htsCalls = 0;
  let topicCalls = 0;

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.pathname === '/api/v1/contracts/0.0.5005/results/logs') {
      contractCalls += 1;
      return jsonResponse({ logs: [], links: { next: null } });
    }

    if (parsed.pathname === '/api/v1/transactions') {
      htsCalls += 1;
      return jsonResponse({
        transactions: [
          {
            transaction_id: '0.0.10-1000-1',
            consensus_timestamp: '1001.000000001',
            token_transfers: [
              { token_id: '0.0.6006', account: '0.0.101', amount: -10, is_approval: false },
              { token_id: '0.0.6006', account: '0.0.102', amount: 10, is_approval: false }
            ]
          }
        ],
        links: { next: null },
      });
    }

    if (parsed.pathname === '/api/v1/topics/0.0.7007/messages') {
      topicCalls += 1;
      return jsonResponse({
        messages: [
          {
            sequence_number: 1,
            message: Buffer.from('hello topic').toString('base64'),
            payer_account_id: '0.0.101',
            chunk_info: { initial_transaction_id: '0.0.101-1002-1' },
            consensus_timestamp: '1002.000000001',
          }
        ],
        links: { next: null },
      });
    }

    throw new Error(`Unhandled URL in targeted sync test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });

  const htsOnly = await indexer.startSyncHts();
  assert.equal(htsOnly.success, true);
  assert.equal(htsOnly.target, 'hts');
  assert.equal(htsOnly.totals.contractLogs, 0);
  assert.equal(htsOnly.totals.htsTransfers, 2);
  assert.equal(htsOnly.totals.topicMessages, 0);

  const topicsOnly = await indexer.startSyncTopics();
  assert.equal(topicsOnly.success, true);
  assert.equal(topicsOnly.target, 'topics');
  assert.equal(topicsOnly.totals.contractLogs, 0);
  assert.equal(topicsOnly.totals.htsTransfers, 0);
  assert.equal(topicsOnly.totals.topicMessages, 1);

  const contractsOnly = await indexer.startSyncContracts();
  assert.equal(contractsOnly.success, true);
  assert.equal(contractsOnly.target, 'contracts');
  assert.equal(contractsOnly.totals.htsTransfers, 0);
  assert.equal(contractsOnly.totals.topicMessages, 0);

  assert.ok(contractCalls > 0);
  assert.ok(htsCalls > 0);
  assert.ok(topicCalls > 0);
  await database.close();
});

test('hts ledger-delta ingestion preserves signed big-int amounts and remains idempotent', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-hts-bigint-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  fs.writeFileSync(path.join(manifestDir, 'hts.json'), JSON.stringify({
    protocol: 'HTS BigInt Protocol',
    network: 'testnet',
    contracts: [],
    tokens: [{ id: '0.0.6006', name: 'Token' }],
    topics: [],
  }, null, 2));

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.pathname === '/api/v1/transactions') {
      const timestamp = parsed.searchParams.get('timestamp');
      if (timestamp === 'gt:0.0') {
        return jsonResponse({
          transactions: [
            {
              transaction_id: '0.0.10-1000-1',
              consensus_timestamp: '1001.000000001',
              token_transfers: [
                { token_id: '0.0.6006', account: '0.0.111', amount: '-9007199254740993', is_approval: false },
                { token_id: '0.0.6006', account: '0.0.222', amount: '9007199254740993', is_approval: false },
              ],
            },
          ],
          links: { next: null },
        });
      }

      if (timestamp === 'gte:1001.000000001') {
        return jsonResponse({
          transactions: [
            {
              transaction_id: '0.0.10-1000-1',
              consensus_timestamp: '1001.000000001',
              token_transfers: [
                { token_id: '0.0.6006', account: '0.0.111', amount: '-9007199254740993', is_approval: false },
                { token_id: '0.0.6006', account: '0.0.222', amount: '9007199254740993', is_approval: false },
              ],
            },
          ],
          links: { next: null },
        });
      }
      return jsonResponse({ transactions: [], links: { next: null } });
    }

    if (parsed.pathname.includes('/contracts/')) {
      return jsonResponse({ logs: [], links: { next: null } });
    }
    if (parsed.pathname.includes('/topics/')) {
      return jsonResponse({ messages: [], links: { next: null } });
    }

    throw new Error(`Unhandled URL in bigint HTS test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });

  const first = await indexer.startSyncHts();
  assert.equal(first.success, true);
  assert.equal(first.totals.htsTransfers, 2);

  const records = database.queryAll(
    `SELECT account_id, amount_signed FROM hts_transfers ORDER BY account_id ASC`
  );
  assert.deepEqual(records, [
    { account_id: '0.0.111', amount_signed: '-9007199254740993' },
    { account_id: '0.0.222', amount_signed: '9007199254740993' },
  ]);

  const second = await indexer.startSyncHts();
  assert.equal(second.success, true);
  assert.equal(second.totals.htsTransfers, 0);

  await database.close();
});

test('hts indexing backfills newly added tokens without missing historical deltas', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-hts-token-addition-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'hts.json');

  const writeManifest = (tokens) => {
    fs.writeFileSync(manifestPath, JSON.stringify({
      protocol: 'HTS Dynamic Tokens',
      network: 'testnet',
      contracts: [],
      tokens,
      topics: [],
    }, null, 2));
  };

  writeManifest([{ id: '0.0.6006', name: 'TokenA' }]);

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  let runLabel = 'run1';
  const runTimestamps = { run1: [], run2: [], run3: [] };

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.pathname === '/api/v1/transactions') {
      const timestamp = parsed.searchParams.get('timestamp');
      runTimestamps[runLabel].push(timestamp);
      if (timestamp === 'gt:0.0') {
        return jsonResponse({
          transactions: [
            {
              transaction_id: '0.0.10-100-1',
              consensus_timestamp: '100.000000001',
              token_transfers: [
                { token_id: '0.0.6006', account: '0.0.111', amount: -11, is_approval: false },
                { token_id: '0.0.6006', account: '0.0.222', amount: 11, is_approval: false },
                { token_id: '0.0.7007', account: '0.0.333', amount: -22, is_approval: false },
                { token_id: '0.0.7007', account: '0.0.444', amount: 22, is_approval: false },
              ],
            },
            {
              transaction_id: '0.0.10-200-1',
              consensus_timestamp: '200.000000001',
              token_transfers: [],
            },
          ],
          links: { next: null },
        });
      }
      return jsonResponse({ transactions: [], links: { next: null } });
    }

    if (parsed.pathname.includes('/contracts/')) {
      return jsonResponse({ logs: [], links: { next: null } });
    }

    if (parsed.pathname.includes('/topics/')) {
      return jsonResponse({ messages: [], links: { next: null } });
    }

    throw new Error(`Unhandled URL in token addition HTS test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });

  const first = await indexer.startSyncHts();
  assert.equal(first.success, true);
  assert.equal(first.totals.htsTransfers, 2);

  writeManifest([
    { id: '0.0.6006', name: 'TokenA' },
    { id: '0.0.7007', name: 'TokenB' },
  ]);

  runLabel = 'run2';
  const second = await indexer.startSyncHts();
  assert.equal(second.success, true);
  assert.equal(second.totals.htsTransfers, 2);
  assert.equal(runTimestamps.run2.includes('gt:0.0'), true);

  const tokenBRows = database.queryOne(
    `SELECT COUNT(*) AS count FROM hts_transfers WHERE token_id = ?`,
    ['testnet:0.0.7007']
  );
  assert.equal(tokenBRows.count, 2);

  runLabel = 'run3';
  const third = await indexer.startSyncHts();
  assert.equal(third.success, true);
  assert.equal(third.totals.htsTransfers, 0);

  await database.close();
});

test('status exposes sync phase telemetry while targeted sync is running', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-phase-'));
  const manifestDir = path.join(tempDir, 'manifests');
  fs.mkdirSync(manifestDir, { recursive: true });

  fs.writeFileSync(path.join(manifestDir, 'phase.json'), JSON.stringify({
    protocol: 'Phase Protocol',
    network: 'testnet',
    contracts: [{ id: '0.0.5005', name: 'Core', category: 'core', priority: true }],
    tokens: [],
    topics: [],
  }, null, 2));

  const dbPath = path.join(tempDir, 'sefi.db');
  const cubeDbPath = path.join(tempDir, 'sefi.cube.db');
  const config = createConfig({
    SEFI_DB_PATH: dbPath,
    SEFI_CUBE_DB_PATH: cubeDbPath,
    SEFI_MANIFESTS_DIR: manifestDir,
    SEFI_NETWORK: 'testnet',
  });

  const database = new SeFiDatabase(config);
  await database.init();

  let releaseContractFetch;
  const contractGate = new Promise((resolve) => {
    releaseContractFetch = resolve;
  });

  const fetchImpl = async (url) => {
    const parsed = new URL(url);

    if (parsed.pathname === '/api/v1/contracts/0.0.5005/results/logs') {
      await contractGate;
      return jsonResponse({ logs: [], links: { next: null } });
    }

    if (parsed.pathname === '/api/v1/transactions') {
      return jsonResponse({ transactions: [], links: { next: null } });
    }

    if (parsed.pathname === '/api/v1/topics/0.0.7007/messages') {
      return jsonResponse({ messages: [], links: { next: null } });
    }

    throw new Error(`Unhandled URL in phase test: ${url}`);
  };

  const indexer = new SeFiIndexer({ config, database, fetchImpl });

  const syncPromise = indexer.startSyncContracts();
  await new Promise((resolve) => setTimeout(resolve, 25));

  const duringRun = indexer.getStatus();
  assert.equal(duringRun.mode, 'sync');
  assert.equal(duringRun.sync.target, 'contracts');
  assert.equal(duringRun.sync.phase, 'contracts');
  assert.ok(duringRun.sync.phase_started_at);
  assert.ok(duringRun.sync.phase_progress);
  assert.equal(duringRun.sync.phase_progress.entity_type, 'contract');

  releaseContractFetch();
  const result = await syncPromise;
  assert.equal(result.success, true);

  const afterRun = indexer.getStatus();
  assert.equal(afterRun.mode, 'idle');
  assert.equal(afterRun.sync.phase, 'idle');
  assert.equal(afterRun.sync.target, null);

  await database.close();
});
