import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';

const cubeModelRoot = path.resolve(process.cwd(), '..', 'cube', 'model', 'cubes');

function readCubeModel(fileName) {
  return fs.readFileSync(path.join(cubeModelRoot, fileName), 'utf8');
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
