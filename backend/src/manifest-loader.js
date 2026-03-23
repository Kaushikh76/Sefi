import fs from 'fs';
import path from 'path';
import {
  canonicalEntityKey,
  hasValidEntityId,
  isEvmAddress,
  normalizeContractId,
  normalizeEvmAddress,
  normalizeHederaId,
} from './identifiers.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateContract(contract, fileName, index) {
  assert(typeof contract === 'object' && contract !== null, `[${fileName}] contracts[${index}] must be an object`);
  assert(typeof contract.id === 'string' && contract.id.trim() !== '', `[${fileName}] contracts[${index}].id is required`);
  assert(hasValidEntityId(contract.id), `[${fileName}] contracts[${index}].id must be a Hedera ID or EVM address`);
  assert(typeof contract.name === 'string' && contract.name.trim() !== '', `[${fileName}] contracts[${index}].name is required`);
  assert(typeof contract.category === 'string' && contract.category.trim() !== '', `[${fileName}] contracts[${index}].category is required`);

  if (contract.evm !== undefined && contract.evm !== null) {
    assert(
      typeof contract.evm === 'string' && isEvmAddress(contract.evm),
      `[${fileName}] contracts[${index}].evm must be an EVM address when provided`
    );
  }

  if (contract.priority !== undefined) {
    assert(typeof contract.priority === 'boolean', `[${fileName}] contracts[${index}].priority must be boolean when provided`);
  }

  return {
    id: normalizeContractId(contract.id),
    name: contract.name.trim(),
    category: contract.category.trim(),
    evm: contract.evm ? normalizeEvmAddress(contract.evm) : null,
    priority: Boolean(contract.priority),
    asset: contract.asset ? String(contract.asset).trim() : null,
  };
}

function validateToken(token, fileName, index) {
  assert(typeof token === 'object' && token !== null, `[${fileName}] tokens[${index}] must be an object`);
  assert(typeof token.id === 'string' && hasValidEntityId(token.id), `[${fileName}] tokens[${index}].id must be a Hedera ID or EVM address`);

  return {
    id: normalizeHederaId(token.id),
    name: token.name ? String(token.name).trim() : null,
    symbol: token.symbol ? String(token.symbol).trim() : null,
    decimals: Number.isInteger(token.decimals) ? token.decimals : null,
  };
}

function validateTopic(topic, fileName, index) {
  assert(typeof topic === 'object' && topic !== null, `[${fileName}] topics[${index}] must be an object`);
  const topicId = topic.id || topic.topicId;
  assert(typeof topicId === 'string' && hasValidEntityId(topicId), `[${fileName}] topics[${index}] requires id (or topicId) in Hedera/EVM format`);

  return {
    id: normalizeHederaId(topicId),
    name: topic.name ? String(topic.name).trim() : null,
  };
}

function parseManifestFile(filePath) {
  const fileName = path.basename(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  let manifest;

  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[${fileName}] invalid JSON: ${error.message}`);
  }

  assert(typeof manifest === 'object' && manifest !== null, `[${fileName}] manifest root must be an object`);
  assert(typeof manifest.protocol === 'string' && manifest.protocol.trim() !== '', `[${fileName}] protocol is required`);

  if (manifest.network !== undefined) {
    assert(typeof manifest.network === 'string' && manifest.network.trim() !== '', `[${fileName}] network must be a string when provided`);
  }

  const contractsInput = manifest.contracts || [];
  const tokensInput = manifest.tokens || [];
  const topicsInput = manifest.topics || [];

  assert(Array.isArray(contractsInput), `[${fileName}] contracts must be an array`);
  assert(Array.isArray(tokensInput), `[${fileName}] tokens must be an array when provided`);
  assert(Array.isArray(topicsInput), `[${fileName}] topics must be an array when provided`);

  const contracts = contractsInput.map((contract, index) => validateContract(contract, fileName, index));
  const tokens = tokensInput.map((token, index) => validateToken(token, fileName, index));
  const topics = topicsInput.map((topic, index) => validateTopic(topic, fileName, index));

  return {
    fileName,
    filePath,
    protocol: manifest.protocol.trim(),
    network: manifest.network ? String(manifest.network).trim().toLowerCase() : null,
    contracts,
    tokens,
    topics,
  };
}

export function loadManifests(manifestsDir, activeNetwork) {
  if (!fs.existsSync(manifestsDir)) {
    throw new Error(`Manifest directory does not exist: ${manifestsDir}`);
  }

  const entries = fs.readdirSync(manifestsDir, { withFileTypes: true });
  const manifestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(manifestsDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

  const loaded = [];
  const skipped = [];

  const contractsMap = new Map();
  const tokensMap = new Map();
  const topicsMap = new Map();

  for (const filePath of manifestFiles) {
    let parsed;
    try {
      parsed = parseManifestFile(filePath);
    } catch (error) {
      skipped.push({
        fileName: path.basename(filePath),
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (parsed.network && activeNetwork && parsed.network !== activeNetwork) {
      skipped.push({
        fileName: parsed.fileName,
        reason: `network mismatch (${parsed.network})`,
      });
      continue;
    }

    loaded.push({
      fileName: parsed.fileName,
      filePath: parsed.filePath,
      protocol: parsed.protocol,
      network: parsed.network,
      contractCount: parsed.contracts.length,
      tokenCount: parsed.tokens.length,
      topicCount: parsed.topics.length,
    });

    for (const contract of parsed.contracts) {
      const key = canonicalEntityKey(contract.id);
      if (!contractsMap.has(key)) {
        contractsMap.set(key, { ...contract, sourceFile: parsed.fileName });
      } else {
        const existing = contractsMap.get(key);
        existing.priority = existing.priority || contract.priority;
      }
    }

    for (const token of parsed.tokens) {
      const key = canonicalEntityKey(token.id);
      if (!tokensMap.has(key)) {
        tokensMap.set(key, token);
      }
    }

    for (const topic of parsed.topics) {
      const key = canonicalEntityKey(topic.id);
      if (!topicsMap.has(key)) {
        topicsMap.set(key, topic);
      }
    }
  }

  const contracts = Array.from(contractsMap.values());
  const priorityContracts = contracts.filter((contract) => contract.priority);

  return {
    activeNetwork,
    loaded,
    skipped,
    contracts,
    priorityContracts,
    tokens: Array.from(tokensMap.values()),
    topics: Array.from(topicsMap.values()),
    tokenIds: Array.from(tokensMap.values()).map((token) => token.id),
    topicIds: Array.from(topicsMap.values()).map((topic) => topic.id),
  };
}
