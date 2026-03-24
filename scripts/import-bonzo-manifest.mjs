import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const bonzoContractsPath = path.join(repoRoot, 'Bonzo', 'src', 'contracts.js');
const manifestPath = path.join(repoRoot, 'SeFi', 'contracts', 'manifests', 'bonzo.mainnet.manifest.json');

const bonzoModule = await import(bonzoContractsPath);
const CONTRACTS = bonzoModule.CONTRACTS;

const CATEGORY_MAP = {
  'lend.core': 'lend-core',
  'lend.oracles': 'lend-oracle',
  'lend.helpers': 'lend-helper',
  'lend.aTokens': 'lend-atoken',
  'lend.debtTokens': 'lend-debt',
  'lend.strategies': 'lend-strategy',
  'lend.implementations': 'lend-implementation',
  'vaults.dualAssetCore': 'vault-dual-core',
  'vaults.oracles': 'vault-oracle',
  'vaults.singleAssetCore': 'vault-single-core',
};

const sourceBuckets = [
  ['lend.core', CONTRACTS.lend.core],
  ['lend.oracles', CONTRACTS.lend.oracles],
  ['lend.helpers', CONTRACTS.lend.helpers],
  ['lend.aTokens', CONTRACTS.lend.aTokens],
  ['lend.debtTokens', CONTRACTS.lend.debtTokens],
  ['lend.strategies', CONTRACTS.lend.strategies],
  ['lend.implementations', CONTRACTS.lend.implementations],
  ['vaults.dualAssetCore', CONTRACTS.vaults.dualAssetCore],
  ['vaults.oracles', CONTRACTS.vaults.oracles],
  ['vaults.singleAssetCore', CONTRACTS.vaults.singleAssetCore],
  ['vaults.singleAssetVaults', CONTRACTS.vaults.singleAssetVaults],
  ['vaults.dualAssetVaults', CONTRACTS.vaults.dualAssetVaults],
  ['vaults.leveragedLSTVaults', CONTRACTS.vaults.leveragedLSTVaults],
];

function inferCategoryFromName(name, fallback) {
  const text = String(name || '');
  if (text.startsWith('Strategy_') || text.endsWith('_Strategy')) return `${fallback}-strategy`;
  if (text.endsWith('_Vault')) return `${fallback}-vault`;
  if (text.endsWith('_Pool')) return `${fallback}-pool`;
  return fallback;
}

function pushContract(targetMap, contract) {
  const key = String(contract.id).trim().toLowerCase();
  if (targetMap.has(key)) {
    const existing = targetMap.get(key);
    existing.priority = Boolean(existing.priority || contract.priority);
    return;
  }
  targetMap.set(key, contract);
}

const contractsMap = new Map();

for (const [bucket, list] of sourceBuckets) {
  for (const item of list) {
    const rawId = String(item.id || item.evm || '').trim();
    if (!rawId) continue;

    let category = CATEGORY_MAP[bucket] || 'bonzo';
    if (bucket === 'vaults.singleAssetVaults') {
      category = inferCategoryFromName(item.name, 'vault-single');
    } else if (bucket === 'vaults.dualAssetVaults') {
      category = inferCategoryFromName(item.name, 'vault-dual');
    } else if (bucket === 'vaults.leveragedLSTVaults') {
      category = inferCategoryFromName(item.name, 'vault-lst');
    }

    const contract = {
      id: rawId,
      name: String(item.name || rawId).trim(),
      category,
    };

    const evm = item.evm ? String(item.evm).trim() : rawId;
    if (evm.toLowerCase().startsWith('0x')) {
      contract.evm = evm;
    }
    if (item.priority === true) contract.priority = true;
    if (item.asset) contract.asset = String(item.asset).trim();

    pushContract(contractsMap, contract);

    // singleAssetVaults include an additional vault address in `vault`
    if (bucket === 'vaults.singleAssetVaults' && item.vault) {
      const vaultId = String(item.vault).trim();
      const sourceName = String(item.name || '').trim();
      const vaultName = sourceName.startsWith('Strategy_')
        ? `Vault_${sourceName.slice('Strategy_'.length)}`
        : `${sourceName}_Vault`;

      pushContract(contractsMap, {
        id: vaultId,
        name: vaultName,
        category: 'vault-single-vault',
        evm: vaultId,
      });
    }
  }
}

const topicsMap = new Map();
for (const point of CONTRACTS.points || []) {
  const topicId = String(point.topicId || point.id || '').trim();
  if (!topicId) continue;
  const key = topicId.toLowerCase();
  if (!topicsMap.has(key)) {
    topicsMap.set(key, {
      id: topicId,
      name: String(point.name || point.ticker || 'Bonzo Points').trim(),
    });
  }
}

const manifest = {
  protocol: 'Bonzo Finance',
  network: 'mainnet',
  contracts: Array.from(contractsMap.values()).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  tokens: (CONTRACTS.lend.underlyingTokens || []).map((token) => ({
    id: String(token.id).trim(),
    name: String(token.name || '').trim(),
    symbol: String(token.symbol || '').trim(),
    decimals: Number.isInteger(token.decimals) ? token.decimals : null,
  })),
  topics: Array.from(topicsMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
};

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const uniqueIds = new Set(manifest.contracts.map((contract) => contract.id.toLowerCase()));

console.log(`Wrote ${manifestPath}`);
console.log(`Contracts: ${manifest.contracts.length} (unique IDs: ${uniqueIds.size})`);
console.log(`Tokens: ${manifest.tokens.length}`);
console.log(`Topics: ${manifest.topics.length}`);
