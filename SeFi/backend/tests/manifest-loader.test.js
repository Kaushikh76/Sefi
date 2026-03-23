import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadManifests } from '../src/manifest-loader.js';

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

test('loadManifests loads and deduplicates contracts/tokens/topics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-manifest-'));

  writeJson(path.join(dir, 'a.json'), {
    protocol: 'Protocol A',
    network: 'testnet',
    contracts: [
      { id: '0.0.1001', name: 'Core', category: 'core', priority: true },
      { id: '0.0.1002', name: 'Vault', category: 'vault' }
    ],
    tokens: [{ id: '0.0.2001', name: 'Token A' }],
    topics: [{ id: '0.0.3001', name: 'Topic A' }]
  });

  writeJson(path.join(dir, 'b.json'), {
    protocol: 'Protocol B',
    network: 'testnet',
    contracts: [
      { id: '0.0.1001', name: 'Core Duplicate', category: 'core' },
      { id: '0.0.1003', name: 'Extra', category: 'helper' }
    ],
    tokens: [{ id: '0.0.2001', name: 'Token A Duplicate' }],
    topics: [{ id: '0.0.3002', name: 'Topic B' }]
  });

  writeJson(path.join(dir, 'c.json'), {
    protocol: 'Mainnet Only',
    network: 'mainnet',
    contracts: [{ id: '0.0.9999', name: 'MainnetCore', category: 'core' }]
  });

  const result = loadManifests(dir, 'testnet');

  assert.equal(result.loaded.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.contracts.length, 3);
  assert.equal(result.priorityContracts.length, 1);
  assert.equal(result.tokenIds.length, 1);
  assert.equal(result.topicIds.length, 2);
});

test('loadManifests skips invalid manifest files and continues loading valid ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-manifest-invalid-'));

  writeJson(path.join(dir, 'bad.json'), {
    protocol: 'Bad Manifest',
    contracts: [{ id: 'bad-id', name: 'Invalid', category: 'core' }]
  });

  writeJson(path.join(dir, 'good.json'), {
    protocol: 'Good Manifest',
    network: 'testnet',
    contracts: [{ id: '0.0.1234', name: 'Valid', category: 'core' }],
  });

  const result = loadManifests(dir, 'testnet');
  assert.equal(result.contracts.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /bad\.json/i);
});

test('loadManifests deduplicates EVM ids regardless of 0x prefix and casing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefi-manifest-evm-dedupe-'));
  writeJson(path.join(dir, 'a.json'), {
    protocol: 'Protocol A',
    network: 'testnet',
    contracts: [{ id: '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa', name: 'PoolA', category: 'vault' }],
  });
  writeJson(path.join(dir, 'b.json'), {
    protocol: 'Protocol B',
    network: 'testnet',
    contracts: [{ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'PoolB', category: 'vault' }],
  });

  const result = loadManifests(dir, 'testnet');
  assert.equal(result.contracts.length, 1);
  assert.equal(result.contracts[0].id, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});
