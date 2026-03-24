import { loadManifests } from './manifest-loader.js';
import { MirrorNodeClient } from './mirror-client.js';
import { decodeErc20Transfer, getEventName } from './events.js';
import {
  canonicalEntityKey,
  hasValidEntityId,
  isEvmAddress,
  normalizeContractId,
  normalizeEvmAddress,
} from './identifiers.js';

function decodeTopicMessage(base64Message) {
  if (!base64Message) return '';
  try {
    return Buffer.from(base64Message, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function splitTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return { seconds: 0n, nanos: 0n };
  const [secondsRaw, nanosRaw = '0'] = text.split('.');
  const seconds = BigInt(secondsRaw || '0');
  const nanos = BigInt((nanosRaw + '000000000').slice(0, 9));
  return { seconds, nanos };
}

function compareTimestamp(left, right) {
  const a = splitTimestamp(left);
  const b = splitTimestamp(right);
  if (a.seconds < b.seconds) return -1;
  if (a.seconds > b.seconds) return 1;
  if (a.nanos < b.nanos) return -1;
  if (a.nanos > b.nanos) return 1;
  return 0;
}

function compareHtsCursorTuple(left, right) {
  const timestampCmp = compareTimestamp(left.timestamp, right.timestamp);
  if (timestampCmp !== 0) return timestampCmp;

  const txIdCmp = String(left.txId || '').localeCompare(String(right.txId || ''));
  if (txIdCmp !== 0) return txIdCmp;

  const leftIndex = Number(left.transferIndex);
  const rightIndex = Number(right.transferIndex);
  return (Number.isFinite(leftIndex) ? leftIndex : -1) - (Number.isFinite(rightIndex) ? rightIndex : -1);
}

function defaultHtsCursor() {
  return {
    timestamp: '0.0',
    txId: '',
    transferIndex: -1,
  };
}

function cloneHtsCursor(cursor) {
  return {
    timestamp: String(cursor?.timestamp || '0.0'),
    txId: String(cursor?.txId || ''),
    transferIndex: Number.isFinite(Number(cursor?.transferIndex)) ? Number(cursor.transferIndex) : -1,
  };
}

function parseHtsCursorFromSyncState(syncState) {
  if (!syncState) {
    return defaultHtsCursor();
  }
  const parsedTransferIndex = Number(syncState.last_index);
  return {
    timestamp: String(syncState.last_timestamp || '0.0'),
    txId: String(syncState.last_tx_id || ''),
    transferIndex: Number.isFinite(parsedTransferIndex) ? parsedTransferIndex : -1,
  };
}

function minHtsCursor(left, right) {
  if (!left) return cloneHtsCursor(right);
  if (!right) return cloneHtsCursor(left);
  return compareHtsCursorTuple(left, right) <= 0 ? cloneHtsCursor(left) : cloneHtsCursor(right);
}

function compareLogCursorTuple(left, right) {
  const timestampCmp = compareTimestamp(left.timestamp, right.timestamp);
  if (timestampCmp !== 0) return timestampCmp;
  const leftIndex = Number(left.index);
  const rightIndex = Number(right.index);
  return (Number.isFinite(leftIndex) ? leftIndex : -1) - (Number.isFinite(rightIndex) ? rightIndex : -1);
}

function normalizeSignedAmount(value) {
  try {
    return BigInt(String(value)).toString();
  } catch {
    return null;
  }
}

function normalizeAccountId(value) {
  return String(value || '').trim();
}

function normalizeEntityIdValue(id) {
  if (isEvmAddress(id)) {
    return normalizeEvmAddress(id);
  }
  return normalizeContractId(id);
}

export class SeFiIndexer {
  constructor({ config, database, fetchImpl = fetch }) {
    this.config = config;
    this.database = database;

    this.isRunning = false;
    this.mode = 'idle';
    this.shouldStop = false;
    this.totalApiCalls = 0;
    this.lastRateLimitTime = 0;
    this.syncPhase = 'idle';
    this.syncPhaseStartedAt = null;
    this.syncPhaseProgress = null;
    this.syncTarget = null;

    this.eventCallbacks = [];

    this.manifestState = {
      activeNetworks: [...(this.config.networks || [this.config.network])],
      loaded: [],
      skipped: [],
      contracts: [],
      priorityContracts: [],
      tokens: [],
      topics: [],
      tokenIds: [],
      topicIds: [],
    };

    this.mirrorClients = new Map();
    const networks = this.config.networks || [this.config.network];
    for (const network of networks) {
      const clientConfig = {
        ...this.config,
        network,
        mirrorRestBaseUrl:
          this.config.mirrorRestByNetwork?.[network] || this.config.mirrorRestBaseUrl,
        mirrorRestPool:
          this.config.mirrorRestPoolByNetwork?.[network] ||
          [this.config.mirrorRestByNetwork?.[network] || this.config.mirrorRestBaseUrl],
      };

      this.mirrorClients.set(
        network,
        new MirrorNodeClient({
          config: clientConfig,
          fetchImpl,
          onRequest: () => {
            this.totalApiCalls += 1;
            this.database.updateStat('total_api_calls', this.totalApiCalls);
          },
          onRateLimit: (timestampMs) => {
            this.lastRateLimitTime = timestampMs;
            this.database.updateStat('last_rate_limit', new Date(timestampMs).toISOString());
            this.emit('rate_limit', { timestamp: new Date(timestampMs).toISOString(), network });
          },
        })
      );
    }
  }

  onEvent(callback) {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== callback);
    };
  }

  emit(event, data = {}) {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event, data);
      } catch {
        // Ignore per-callback failures.
      }
    }
  }

  getMirrorClient(network) {
    if (this.mirrorClients.has(network)) {
      return this.mirrorClients.get(network);
    }
    if (this.mirrorClients.has(this.config.network)) {
      return this.mirrorClients.get(this.config.network);
    }
    return null;
  }

  toScopedId(network, id) {
    return `${network}:${id}`;
  }

  parseScopedId(scopedId) {
    const value = String(scopedId || '');
    const delimiter = value.indexOf(':');
    if (delimiter <= 0) {
      return {
        network: this.config.network,
        id: value,
      };
    }
    return {
      network: value.slice(0, delimiter),
      id: value.slice(delimiter + 1),
    };
  }

  setSyncPhase(phase, progress = null) {
    this.syncPhase = phase;
    this.syncPhaseStartedAt = phase === 'idle' ? null : new Date().toISOString();
    this.syncPhaseProgress = progress;
  }

  setSyncPhaseProgress(progress) {
    this.syncPhaseProgress = progress;
  }

  orderContractsForIndexing(contracts) {
    if (!Array.isArray(contracts) || contracts.length === 0) return [];

    const deferredNames = new Set(
      (Array.isArray(this.config.indexDeferContractNames) ? this.config.indexDeferContractNames : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const scopedIds = contracts.map((contract) =>
      this.toScopedId(contract.network || this.config.network, contract.id)
    );
    const progressByScopedId = new Map();

    if (scopedIds.length > 0) {
      const placeholders = scopedIds.map(() => '?').join(', ');
      const rows = this.database.queryAll(
        `SELECT entity_id, COALESCE(items_synced, 0) AS items_synced
           FROM sync_state
          WHERE entity_type = 'contract'
            AND entity_id IN (${placeholders})`,
        scopedIds
      );
      for (const row of rows) {
        const scopedId = String(row?.entity_id || '').trim();
        if (!scopedId) continue;
        progressByScopedId.set(scopedId, Number(row?.items_synced || 0));
      }
    }

    const decorated = contracts.map((contract) => {
      const scopedId = this.toScopedId(contract.network || this.config.network, contract.id);
      const normalizedName = String(contract?.name || '').trim().toLowerCase();
      const itemsSynced = Number(progressByScopedId.get(scopedId) || 0);
      return {
        contract,
        scopedId,
        normalizedName,
        itemsSynced: Number.isFinite(itemsSynced) ? itemsSynced : 0,
        deferred: deferredNames.has(normalizedName),
      };
    });

    decorated.sort((left, right) => {
      if (left.deferred !== right.deferred) {
        return left.deferred ? 1 : -1;
      }

      if (left.itemsSynced !== right.itemsSynced) {
        return left.itemsSynced - right.itemsSynced;
      }

      const byName = left.normalizedName.localeCompare(right.normalizedName);
      if (byName !== 0) return byName;

      return left.scopedId.localeCompare(right.scopedId);
    });

    return decorated.map((entry) => entry.contract);
  }

  refreshManifests() {
    const networks = this.config.networks || [this.config.network];
    const loaded = [];
    const rawSkipped = [];
    const contractsMap = new Map();
    const tokensMap = new Map();
    const topicsMap = new Map();

    for (const network of networks) {
      const manifests = loadManifests(this.config.manifestsDir, network);
      loaded.push(
        ...manifests.loaded.map((entry) => ({
          ...entry,
          activeNetwork: network,
        }))
      );
      rawSkipped.push(
        ...manifests.skipped.map((entry) => ({
          ...entry,
          activeNetwork: network,
        }))
      );

      for (const contract of manifests.contracts) {
        const normalizedContractId = normalizeEntityIdValue(contract.id);
        if (!hasValidEntityId(normalizedContractId)) {
          this.database.logIngestError({
            source: 'manifest',
            entityType: 'contract',
            entityId: String(contract.id || ''),
            reason: `Invalid contract id for network ${network}`,
            payload: contract,
          });
          continue;
        }
        const scopedId = this.toScopedId(network, canonicalEntityKey(normalizedContractId));
        if (!contractsMap.has(scopedId)) {
          contractsMap.set(scopedId, {
            ...contract,
            sourceFile: contract.sourceFile,
            id: normalizedContractId,
            network,
          });
        }
      }

      for (const token of manifests.tokens) {
        const normalizedTokenId = normalizeEntityIdValue(token.id);
        if (!hasValidEntityId(normalizedTokenId)) {
          this.database.logIngestError({
            source: 'manifest',
            entityType: 'token',
            entityId: String(token.id || ''),
            reason: `Invalid token id for network ${network}`,
            payload: token,
          });
          continue;
        }
        const scopedId = this.toScopedId(network, canonicalEntityKey(normalizedTokenId));
        if (!tokensMap.has(scopedId)) {
          tokensMap.set(scopedId, {
            ...token,
            id: normalizedTokenId,
            network,
          });
        }
      }

      for (const topic of manifests.topics) {
        const normalizedTopicId = normalizeEntityIdValue(topic.id);
        if (!hasValidEntityId(normalizedTopicId)) {
          this.database.logIngestError({
            source: 'manifest',
            entityType: 'topic',
            entityId: String(topic.id || ''),
            reason: `Invalid topic id for network ${network}`,
            payload: topic,
          });
          continue;
        }
        const scopedId = this.toScopedId(network, canonicalEntityKey(normalizedTopicId));
        if (!topicsMap.has(scopedId)) {
          topicsMap.set(scopedId, {
            ...topic,
            id: normalizedTopicId,
            network,
          });
        }
      }
    }

    // Merge dynamically registered agent topics so agent-published HCS messages
    // are indexed through the same topic pipeline.
    const agentTopicRegistrations = this.database.getAllAgentTopicRegistrations();
    for (const registration of agentTopicRegistrations) {
      const network = String(registration.network || '').trim().toLowerCase();
      const topicId = normalizeEntityIdValue(registration.topic_id);
      if (!network || !topicId) continue;
      if (!networks.includes(network)) continue;
      if (!hasValidEntityId(topicId)) {
        this.database.logIngestError({
          source: 'agent_topic_registration',
          entityType: 'topic',
          entityId: String(registration.topic_id || ''),
          reason: `Invalid agent topic id for network ${network}`,
          payload: registration,
        });
        continue;
      }
      const scopedId = this.toScopedId(network, canonicalEntityKey(topicId));
      if (topicsMap.has(scopedId)) continue;
      topicsMap.set(scopedId, {
        id: topicId,
        name: registration.label || `Agent Topic ${topicId}`,
        network,
      });
    }

    const contracts = this.orderContractsForIndexing(Array.from(contractsMap.values()));
    const tokens = Array.from(tokensMap.values());
    const topics = Array.from(topicsMap.values());
    const loadedFileNames = new Set(loaded.map((entry) => entry.fileName));
    const skippedByFile = new Map();
    for (const entry of rawSkipped) {
      if (loadedFileNames.has(entry.fileName)) continue;
      if (!skippedByFile.has(entry.fileName)) {
        skippedByFile.set(entry.fileName, entry);
      }
    }
    const skipped = Array.from(skippedByFile.values());
    for (const skippedManifest of skipped) {
      this.database.logIngestError({
        source: 'manifest',
        entityType: 'manifest',
        entityId: skippedManifest.fileName,
        reason: skippedManifest.reason || 'manifest skipped',
        payload: skippedManifest,
      });
    }

    this.manifestState = {
      activeNetworks: [...networks],
      loaded,
      skipped,
      contracts,
      priorityContracts: contracts.filter((contract) => contract.priority),
      tokens,
      topics,
      tokenIds: tokens.map((token) => this.toScopedId(token.network, token.id)),
      topicIds: topics.map((topic) => this.toScopedId(topic.network, topic.id)),
    };

    this.database.updateStat('manifests_loaded', this.manifestState.loaded.length);

    const scopedContractIds = [];
    for (const contract of contracts) {
      const scopedId = this.toScopedId(contract.network, contract.id);
      scopedContractIds.push(scopedId);
      this.database.registerContract({
        ...contract,
        id: scopedId,
        name: `${contract.name} [${contract.network}]`,
        canonicalName: contract.name,
      });
    }

    this.database.removeLegacyUnscopedContracts(scopedContractIds);

    return this.manifestState;
  }

  getManifestSummary() {
    return {
      activeNetworks: this.manifestState.activeNetworks,
      loaded: this.manifestState.loaded,
      skipped: this.manifestState.skipped,
      totals: {
        contracts: this.manifestState.contracts.length,
        tokens: this.manifestState.tokens.length,
        topics: this.manifestState.topics.length,
      },
    };
  }

  async indexContractLogs(contract, isBackfill) {
    if (this.database.isDatabaseFull()) {
      return { indexed: 0, erc20Indexed: 0, stopped: true };
    }

    const network = contract.network || this.config.network;
    const mirrorClient = this.getMirrorClient(network);
    if (!mirrorClient) {
      throw new Error(`No mirror client configured for network: ${network}`);
    }

    const normalizedContractId = normalizeEntityIdValue(contract.id);
    if (!hasValidEntityId(normalizedContractId)) {
      this.database.logIngestError({
        source: 'contract_logs',
        entityType: 'contract',
        entityId: String(contract.id || ''),
        reason: `Invalid contract id for network ${network}`,
        payload: contract,
      });
      this.emit('warning', { type: 'contract_skip', contractId: String(contract.id || ''), error: 'invalid contract id' });
      return { indexed: 0, erc20Indexed: 0, stopped: false };
    }

    const scopedContractId = this.toScopedId(network, normalizedContractId);
    const contractDisplayName = `${contract.name} [${network}]`;

    this.database.registerContract({
      ...contract,
      id: scopedContractId,
      name: contractDisplayName,
      canonicalName: contract.name,
    });

    const syncState = this.database.getSyncState(scopedContractId);
    const lastTimestamp = syncState?.last_timestamp || '0.0';
    const parsedLastIndex = Number(syncState?.last_index);
    const lastIndex = Number.isFinite(parsedLastIndex) ? parsedLastIndex : -1;

    this.emit('indexing', {
      type: 'contract_logs',
      network,
      contractId: scopedContractId,
      contractName: contractDisplayName,
      lastTimestamp,
      lastIndex,
    });

    let totalIndexed = 0;
    let totalErc20Indexed = 0;
    let cursorTimestamp = lastTimestamp;
    let cursorIndex = lastIndex;

    let page = await mirrorClient.fetchContractLogs(normalizedContractId, {
      timestamp: cursorTimestamp === '0.0' ? 'gt:0.0' : `gte:${cursorTimestamp}`,
    });

    while (!this.shouldStop && page && Array.isArray(page.logs) && page.logs.length > 0) {
      const transformedLogs = [];
      const erc20Transfers = [];
      let batchCursor = { timestamp: cursorTimestamp, index: cursorIndex };

      for (const log of page.logs) {
        const logTimestamp = String(log.timestamp || '').trim();
        const logIndex = Number.isFinite(log.index) ? Number(log.index) : Number.parseInt(log.index, 10);

        if (!logTimestamp || !Number.isFinite(logIndex)) {
          this.database.logIngestError({
            source: 'contract_logs',
            entityType: 'log',
            entityId: scopedContractId,
            reason: 'Invalid contract log cursor fields (timestamp/index)',
            payload: log,
          });
          continue;
        }

        const currentCursor = { timestamp: logTimestamp, index: logIndex };
        if (compareLogCursorTuple(currentCursor, batchCursor) > 0) {
          batchCursor = currentCursor;
        }
        if (compareLogCursorTuple(currentCursor, { timestamp: cursorTimestamp, index: cursorIndex }) <= 0) {
          continue;
        }

        transformedLogs.push({
          contract_id: scopedContractId,
          tx_hash: log.transaction_hash || null,
          event_name: getEventName(log.topics?.[0]),
          topic0: log.topics?.[0] || null,
          topic1: log.topics?.[1] || null,
          topic2: log.topics?.[2] || null,
          topic3: log.topics?.[3] || null,
          data: log.data || null,
          block_number: log.block_number ?? null,
          log_index: logIndex,
          timestamp: logTimestamp,
        });

        const decodedTransfer = decodeErc20Transfer(log);
        if (decodedTransfer) {
          erc20Transfers.push({
            contract_id: scopedContractId,
            token_name: contract.asset || contract.name,
            from_address: decodedTransfer.fromAddress,
            to_address: decodedTransfer.toAddress,
            amount: decodedTransfer.amount,
            tx_hash: log.transaction_hash || null,
            log_index: logIndex,
            timestamp: logTimestamp,
          });
        }
      }

      const inserted = this.database.insertContractLogs(transformedLogs);
      const erc20Inserted = erc20Transfers.length > 0 ? this.database.insertErc20Transfers(erc20Transfers) : 0;

      totalIndexed += inserted;
      totalErc20Indexed += erc20Inserted;

      if (compareLogCursorTuple(batchCursor, { timestamp: cursorTimestamp, index: cursorIndex }) > 0) {
        cursorTimestamp = batchCursor.timestamp;
        cursorIndex = batchCursor.index;

        this.database.updateSyncState(scopedContractId, 'contract', {
          lastTimestamp: cursorTimestamp,
          lastIndex: Number.isFinite(cursorIndex) ? cursorIndex : -1,
          incrementBy: inserted,
        });
      } else if (inserted > 0) {
        this.database.updateSyncState(scopedContractId, 'contract', {
          lastTimestamp: cursorTimestamp,
          lastIndex: Number.isFinite(cursorIndex) ? cursorIndex : -1,
          incrementBy: inserted,
        });
      }

      if (inserted > 0 || erc20Inserted > 0) {
        this.database.logActivity(
          'contract_indexed',
          contractDisplayName,
          `Indexed ${inserted} logs (${erc20Inserted} ERC20 transfers)`
        );
      }

      this.emit('logs_indexed', {
        network,
        contractId: scopedContractId,
        contractName: contractDisplayName,
        inserted,
        erc20Inserted,
        totalIndexed,
        totalErc20Indexed,
        lastTimestamp: cursorTimestamp,
        lastIndex: cursorIndex,
      });

      if (this.database.isDatabaseFull()) {
        return { indexed: totalIndexed, erc20Indexed: totalErc20Indexed, stopped: true };
      }

      if (page.links?.next) {
        page = await mirrorClient.fetchNextPage(page.links.next);
      } else {
        page = null;
      }

      if (page) {
        await mirrorClient.delayForMode(isBackfill);
      }
    }

    return {
      indexed: totalIndexed,
      erc20Indexed: totalErc20Indexed,
      stopped: this.shouldStop,
    };
  }

  async indexHtsTransfers(tokenIds, isBackfill, onProgress = null) {
    if (this.database.isDatabaseFull()) {
      return { indexed: 0, stopped: true };
    }

    if (!tokenIds || tokenIds.length === 0) {
      return { indexed: 0, stopped: false };
    }

    let totalIndexed = 0;
    const tokensByNetwork = new Map();
    for (const tokenId of tokenIds) {
      const parsed = this.parseScopedId(tokenId);
      if (!parsed.id) continue;
      if (!tokensByNetwork.has(parsed.network)) {
        tokensByNetwork.set(parsed.network, new Set());
      }
      tokensByNetwork.get(parsed.network).add(parsed.id);
    }

    const networkEntries = Array.from(tokensByNetwork.entries());
    for (let networkIndex = 0; networkIndex < networkEntries.length; networkIndex += 1) {
      const [network, tokenSet] = networkEntries[networkIndex];
      if (this.shouldStop) break;

      if (typeof onProgress === 'function') {
        onProgress({
          current: networkIndex + 1,
          total: networkEntries.length,
          entity_type: 'token_network',
          entity_id: network,
          entity_name: `${tokenSet.size} token${tokenSet.size === 1 ? '' : 's'}`,
          last_timestamp: null,
        });
      }

      const mirrorClient = this.getMirrorClient(network);
      if (!mirrorClient) {
        throw new Error(`No mirror client configured for network: ${network}`);
      }

      const syncStateKey = this.toScopedId(network, 'hts_global');
      const targetTokens = new Map();
      for (const tokenId of tokenSet) {
        const normalizedTokenId = normalizeEntityIdValue(tokenId);
        if (!hasValidEntityId(normalizedTokenId)) {
          this.database.logIngestError({
            source: 'hts_transfers',
            entityType: 'token',
            entityId: String(tokenId || ''),
            reason: `Invalid token id in HTS target set for network ${network}`,
            payload: { tokenId, network },
          });
          continue;
        }
        const tokenKey = canonicalEntityKey(normalizedTokenId);
        if (!targetTokens.has(tokenKey)) {
          targetTokens.set(tokenKey, normalizedTokenId);
        }
      }
      if (targetTokens.size === 0) {
        continue;
      }

      const tokenSyncState = new Map();
      let networkCursor = null;
      for (const [tokenKey, normalizedTokenId] of targetTokens.entries()) {
        const tokenSyncStateKey = this.toScopedId(network, `hts_token:${tokenKey}`);
        const cursor = parseHtsCursorFromSyncState(this.database.getSyncState(tokenSyncStateKey));
        tokenSyncState.set(tokenKey, {
          tokenId: normalizedTokenId,
          syncStateKey: tokenSyncStateKey,
          cursor,
          batchCursor: cloneHtsCursor(cursor),
        });
        networkCursor = minHtsCursor(networkCursor, cursor);
      }
      networkCursor = networkCursor || defaultHtsCursor();

      let page = await mirrorClient.fetchTransactions({
        timestamp: networkCursor.timestamp === '0.0' ? 'gt:0.0' : `gte:${networkCursor.timestamp}`,
      });

      while (!this.shouldStop && page && Array.isArray(page.transactions) && page.transactions.length > 0) {
        const deltas = [];
        let pageMaxCursor = cloneHtsCursor(networkCursor);

        for (const transaction of page.transactions) {
          const txTimestamp = String(transaction.consensus_timestamp || '');
          const txId = String(transaction.transaction_id || '');
          if (!txTimestamp || !txId) {
            this.database.logIngestError({
              source: 'hts_transfers',
              entityType: 'transaction',
              entityId: txId || 'unknown',
              reason: 'Missing transaction_id or consensus_timestamp',
              payload: transaction,
            });
            continue;
          }

          const baseCursor = { timestamp: txTimestamp, txId, transferIndex: -1 };
          if (compareHtsCursorTuple(baseCursor, pageMaxCursor) > 0) {
            pageMaxCursor = baseCursor;
          }

          const tokenTransfers = Array.isArray(transaction.token_transfers) ? transaction.token_transfers : [];
          for (let transferIndex = 0; transferIndex < tokenTransfers.length; transferIndex += 1) {
            const transfer = tokenTransfers[transferIndex];
            const tokenId = normalizeEntityIdValue(transfer.token_id);
            if (!hasValidEntityId(tokenId)) {
              this.database.logIngestError({
                source: 'hts_transfers',
                entityType: 'token_transfer',
                entityId: txId,
                reason: 'Invalid token_id in token transfer',
                payload: transfer,
              });
              continue;
            }
            const tokenKey = canonicalEntityKey(tokenId);
            const tokenState = tokenSyncState.get(tokenKey);
            if (!tokenState) continue;

            const currentCursor = { timestamp: txTimestamp, txId, transferIndex };
            if (compareHtsCursorTuple(currentCursor, tokenState.cursor) <= 0) {
              continue;
            }
            if (compareHtsCursorTuple(currentCursor, tokenState.batchCursor) > 0) {
              tokenState.batchCursor = currentCursor;
            }
            if (compareHtsCursorTuple(currentCursor, pageMaxCursor) > 0) {
              pageMaxCursor = currentCursor;
            }

            const accountId = normalizeAccountId(transfer.account);
            const amountSigned = normalizeSignedAmount(transfer.amount);
            if (!accountId || !hasValidEntityId(accountId) || amountSigned === null) {
              this.database.logIngestError({
                source: 'hts_transfers',
                entityType: 'token_transfer',
                entityId: txId,
                reason: 'Invalid token transfer payload (account or amount)',
                payload: transfer,
              });
              continue;
            }

            deltas.push({
              token_id: this.toScopedId(network, tokenId),
              network,
              account_id: accountId,
              amount_signed: amountSigned,
              amount_abs: amountSigned.startsWith('-') ? amountSigned.slice(1) : amountSigned,
              tx_id: txId,
              consensus_timestamp: txTimestamp,
              transfer_index: transferIndex,
              is_approval: Boolean(transfer.is_approval),
            });
          }
        }

        const inserted = deltas.length > 0 ? this.database.insertHtsTransfers(deltas) : 0;
        totalIndexed += inserted;

        for (const state of tokenSyncState.values()) {
          if (compareHtsCursorTuple(pageMaxCursor, state.batchCursor) > 0) {
            state.batchCursor = cloneHtsCursor(pageMaxCursor);
          }
          if (compareHtsCursorTuple(state.batchCursor, state.cursor) <= 0) {
            continue;
          }
          state.cursor = cloneHtsCursor(state.batchCursor);
          this.database.updateSyncState(state.syncStateKey, 'hts_token', {
            lastTimestamp: state.cursor.timestamp,
            lastTxId: state.cursor.txId,
            lastIndex: state.cursor.transferIndex,
            incrementBy: 0,
          });
        }

        networkCursor = null;
        for (const state of tokenSyncState.values()) {
          networkCursor = minHtsCursor(networkCursor, state.cursor);
        }
        networkCursor = networkCursor || defaultHtsCursor();

        this.database.updateSyncState(syncStateKey, 'hts', {
          lastTimestamp: networkCursor.timestamp,
          lastTxId: networkCursor.txId,
          lastIndex: networkCursor.transferIndex,
          incrementBy: inserted,
        });

        if (inserted > 0) {
          this.database.logActivity('hts_indexed', network, `Indexed ${inserted} HTS ledger deltas`);
        }

        this.emit('hts_indexed', {
          network,
          inserted,
          totalIndexed,
          lastTimestamp: networkCursor.timestamp,
          lastTxId: networkCursor.txId,
          lastTransferIndex: networkCursor.transferIndex,
          pageMaxTimestamp: pageMaxCursor.timestamp,
          pageMaxTxId: pageMaxCursor.txId,
          pageMaxTransferIndex: pageMaxCursor.transferIndex,
        });

        if (typeof onProgress === 'function') {
          onProgress({
            current: networkIndex + 1,
            total: networkEntries.length,
            entity_type: 'token_network',
            entity_id: network,
            entity_name: `${tokenSet.size} token${tokenSet.size === 1 ? '' : 's'}`,
            last_timestamp: networkCursor.timestamp,
          });
        }

        if (this.database.isDatabaseFull()) {
          return { indexed: totalIndexed, stopped: true };
        }

        if (page.links?.next) {
          page = await mirrorClient.fetchNextPage(page.links.next);
        } else {
          page = null;
        }

        if (page) {
          await mirrorClient.delayForMode(isBackfill);
        }
      }
    }

    return { indexed: totalIndexed, stopped: this.shouldStop };
  }

  async indexTopicMessages(topicId, isBackfill) {
    if (this.database.isDatabaseFull()) {
      return { indexed: 0, stopped: true };
    }

    const parsedTopic = this.parseScopedId(topicId);
    const network = parsedTopic.network;
    const rawTopicId = normalizeEntityIdValue(parsedTopic.id);
    if (!hasValidEntityId(rawTopicId)) {
      this.database.logIngestError({
        source: 'topic_messages',
        entityType: 'topic',
        entityId: String(topicId || ''),
        reason: `Invalid topic id for network ${network}`,
        payload: { topicId },
      });
      this.emit('warning', { type: 'topic_skip', topicId: String(topicId || ''), error: 'invalid topic id' });
      return { indexed: 0, stopped: false };
    }
    const mirrorClient = this.getMirrorClient(network);
    if (!mirrorClient) {
      throw new Error(`No mirror client configured for network: ${network}`);
    }

    const scopedTopicId = this.toScopedId(network, rawTopicId);
    const entityId = `topic:${scopedTopicId}`;
    const syncState = this.database.getSyncState(entityId);
    let cursorTimestamp = syncState?.last_timestamp || '0.0';

    let totalIndexed = 0;

    const parsedSequence = Number(syncState?.last_index);
    const cursorSequence = Number.isFinite(parsedSequence) ? parsedSequence : -1;

    let page = await mirrorClient.fetchTopicMessages(rawTopicId, {
      timestamp: cursorTimestamp === '0.0' ? 'gt:0.0' : `gte:${cursorTimestamp}`,
      sequencenumber: cursorSequence >= 0 ? `gt:${cursorSequence}` : undefined,
    });

    while (!this.shouldStop && page && Array.isArray(page.messages) && page.messages.length > 0) {
      const transformed = page.messages.map((message) => ({
        topic_id: scopedTopicId,
        sequence_number: message.sequence_number,
        message_base64: message.message || null,
        message_utf8: decodeTopicMessage(message.message),
        payer_account_id: message.payer_account_id || null,
        tx_id: message.chunk_info?.initial_transaction_id || null,
        consensus_timestamp: message.consensus_timestamp,
      }));

      const inserted = this.database.insertTopicMessages(transformed);
      totalIndexed += inserted;

      const lastMessage = page.messages[page.messages.length - 1];
      cursorTimestamp = lastMessage.consensus_timestamp;

      this.database.updateSyncState(entityId, 'topic', {
        lastTimestamp: cursorTimestamp,
        lastIndex: Number(lastMessage.sequence_number) || -1,
        incrementBy: inserted,
      });

      if (inserted > 0) {
        this.database.logActivity('topic_indexed', scopedTopicId, `Indexed ${inserted} topic messages`);
      }

      this.emit('topic_messages_indexed', {
        network,
        topicId: scopedTopicId,
        inserted,
        totalIndexed,
        lastTimestamp: cursorTimestamp,
      });

      if (this.database.isDatabaseFull()) {
        return { indexed: totalIndexed, stopped: true };
      }

      if (page.links?.next) {
        page = await mirrorClient.fetchNextPage(page.links.next);
      } else {
        page = null;
      }

      if (page) {
        await mirrorClient.delayForMode(isBackfill);
      }
    }

    return { indexed: totalIndexed, stopped: this.shouldStop };
  }

  async runSync(target = 'all') {
    if (this.isRunning) {
      return { error: 'Indexer is already running' };
    }

    const syncTarget = ['all', 'contracts', 'hts', 'topics'].includes(target) ? target : 'all';
    const includeContracts = syncTarget === 'all' || syncTarget === 'contracts';
    const includeHts = syncTarget === 'all' || syncTarget === 'hts';
    const includeTopics = syncTarget === 'all' || syncTarget === 'topics';

    this.isRunning = true;
    this.shouldStop = false;
    this.mode = 'sync';
    this.syncTarget = syncTarget;
    this.setSyncPhase('idle', null);

    this.database.updateStat('mode', 'sync');
    this.database.updateStat('sync_started_at', new Date().toISOString());
    this.database.logActivity(
      'sync_start',
      null,
      syncTarget === 'all' ? 'Starting sync run' : `Starting sync run (target: ${syncTarget})`
    );

    this.emit('sync_started', { target: syncTarget });

    let totalLogs = 0;
    let totalErc20 = 0;
    let totalHts = 0;
    let totalTopics = 0;

    try {
      const manifests = this.refreshManifests();

      this.emit('manifests_loaded', this.getManifestSummary());
      const activeNetworksText = (this.config.networks || [this.config.network]).join(', ');

      if (Array.isArray(manifests.skipped) && manifests.skipped.length > 0) {
        const skipSummary = manifests.skipped.map((item) => `${item.fileName}: ${item.reason}`).join(' | ');
        this.database.logActivity('manifest_warning', null, `Skipped manifests for active networks "${activeNetworksText}": ${skipSummary}`);
      }

      const selectedTargetCount =
        (includeContracts ? manifests.contracts.length : 0) +
        (includeHts ? manifests.tokenIds.length : 0) +
        (includeTopics ? manifests.topicIds.length : 0);

      if (selectedTargetCount === 0) {
        const warningMessage =
          manifests.skipped.length > 0
            ? `No index targets for active networks "${activeNetworksText}". Check manifest network values.`
            : `No index targets configured for active networks "${activeNetworksText}".`;

        this.database.logActivity('sync_warning', null, warningMessage);
        this.emit('warning', { type: 'sync', message: warningMessage });

        return {
          success: true,
          target: syncTarget,
          stopped: this.shouldStop,
          warning: warningMessage,
          totals: {
            contractLogs: 0,
            erc20Transfers: 0,
            htsTransfers: 0,
            topicMessages: 0,
          },
        };
      }

      if (includeContracts && !this.shouldStop) {
        const priorityContracts = manifests.priorityContracts;
        const regularContracts = manifests.contracts.filter((contract) => !contract.priority);
        const contractsToSync = [...priorityContracts, ...regularContracts];

        this.setSyncPhase('contracts', {
          current: 0,
          total: contractsToSync.length,
          entity_type: 'contract',
          entity_id: null,
          entity_name: null,
          last_timestamp: null,
        });

        for (let index = 0; index < contractsToSync.length; index += 1) {
          if (this.shouldStop) break;
          const contract = contractsToSync[index];
          const contractNetwork = contract.network || this.config.network;
          const scopedContractId = this.toScopedId(contractNetwork, contract.id);
          this.setSyncPhaseProgress({
            current: index + 1,
            total: contractsToSync.length,
            entity_type: 'contract',
            entity_id: scopedContractId,
            entity_name: contract.name,
            last_timestamp: null,
          });
          try {
            const result = await this.indexContractLogs(contract, true);
            totalLogs += result.indexed;
            totalErc20 += result.erc20Indexed;
          } catch (contractError) {
            this.database.logActivity('contract_skip', contract.name, contractError.message);
            this.emit('warning', { type: 'contract_skip', contractId: scopedContractId, error: contractError.message });
          }
        }

        this.database.updateStat('last_sync_contract_logs', totalLogs);
      }

      if (includeHts && !this.shouldStop) {
        this.setSyncPhase('hts', {
          current: 0,
          total: manifests.tokenIds.length,
          entity_type: 'token',
          entity_id: null,
          entity_name: null,
          last_timestamp: null,
        });
        try {
          const htsResult = await this.indexHtsTransfers(
            manifests.tokenIds,
            true,
            (progress) => this.setSyncPhaseProgress(progress)
          );
          totalHts += htsResult.indexed;
        } catch (htsError) {
          this.database.logActivity('hts_skip', null, htsError.message);
          this.emit('warning', { type: 'hts_skip', error: htsError.message });
        }
        this.database.updateStat('last_sync_hts_transfers', totalHts);
      }

      if (includeTopics && !this.shouldStop) {
        this.setSyncPhase('topics', {
          current: 0,
          total: manifests.topicIds.length,
          entity_type: 'topic',
          entity_id: null,
          entity_name: null,
          last_timestamp: null,
        });
        for (let topicIndex = 0; topicIndex < manifests.topicIds.length; topicIndex += 1) {
          if (this.shouldStop) break;
          const topicId = manifests.topicIds[topicIndex];
          this.setSyncPhaseProgress({
            current: topicIndex + 1,
            total: manifests.topicIds.length,
            entity_type: 'topic',
            entity_id: topicId,
            entity_name: topicId,
            last_timestamp: null,
          });
          try {
            const topicResult = await this.indexTopicMessages(topicId, true);
            totalTopics += topicResult.indexed;
          } catch (topicError) {
            this.database.logActivity('topic_skip', topicId, topicError.message);
            this.emit('warning', { type: 'topic_skip', topicId, error: topicError.message });
          }
        }
        this.database.updateStat('last_sync_topic_messages', totalTopics);
      }

      this.setSyncPhase('idle', null);

      this.database.logActivity(
        'sync_complete',
        null,
        this.shouldStop
          ? `Sync stopped by request (${syncTarget}) (logs: ${totalLogs}, hts: ${totalHts}, topics: ${totalTopics}, erc20: ${totalErc20})`
          : `Sync complete (${syncTarget}) (logs: ${totalLogs}, hts: ${totalHts}, topics: ${totalTopics}, erc20: ${totalErc20})`
      );

      this.emit('sync_complete', {
        target: syncTarget,
        stopped: this.shouldStop,
        totals: {
          contractLogs: totalLogs,
          erc20Transfers: totalErc20,
          htsTransfers: totalHts,
          topicMessages: totalTopics,
        },
      });

      return {
        success: true,
        target: syncTarget,
        stopped: this.shouldStop,
        totals: {
          contractLogs: totalLogs,
          erc20Transfers: totalErc20,
          htsTransfers: totalHts,
          topicMessages: totalTopics,
        },
      };
    } catch (error) {
      this.setSyncPhase('idle', null);
      this.database.logActivity(
        'sync_error',
        null,
        syncTarget === 'all' ? error.message : `[${syncTarget}] ${error.message}`
      );
      this.emit('error', { type: 'sync', target: syncTarget, error: error.message });
      return { success: false, error: error.message };
    } finally {
      this.isRunning = false;
      this.mode = 'idle';
      this.syncTarget = null;
      this.setSyncPhase('idle', null);
      this.database.updateStat('mode', 'idle');
      this.database.enableSnapshots();
      await this.database.forceSave();
    }
  }

  async startSync() {
    return this.runSync('all');
  }

  async startSyncContracts() {
    return this.runSync('contracts');
  }

  async startSyncHts() {
    return this.runSync('hts');
  }

  async startSyncTopics() {
    return this.runSync('topics');
  }

  async startListen() {
    if (this.isRunning) {
      return { error: 'Indexer is already running' };
    }

    this.isRunning = true;
    this.shouldStop = false;
    this.mode = 'listen';
    this.syncTarget = 'listen';
    this.setSyncPhase('idle', null);

    this.database.enableSnapshots();
    this.database.updateStat('mode', 'listen');
    this.database.updateStat('listen_started_at', new Date().toISOString());
    this.database.logActivity('listen_start', null, 'Starting near-real-time polling loop');
    this.emit('listen_started', {});

    try {
      const listenClient = this.getMirrorClient((this.config.networks || [this.config.network])[0]);
      while (!this.shouldStop) {
        const manifests = this.refreshManifests();

        this.setSyncPhase('contracts', {
          current: 0,
          total: manifests.contracts.length,
          entity_type: 'contract',
          entity_id: null,
          entity_name: null,
          last_timestamp: null,
        });

        for (let contractIndex = 0; contractIndex < manifests.contracts.length; contractIndex += 1) {
          if (this.shouldStop) break;
          const contract = manifests.contracts[contractIndex];
          const contractNetwork = contract.network || this.config.network;
          this.setSyncPhaseProgress({
            current: contractIndex + 1,
            total: manifests.contracts.length,
            entity_type: 'contract',
            entity_id: this.toScopedId(contractNetwork, contract.id),
            entity_name: contract.name,
            last_timestamp: null,
          });
          try {
            await this.indexContractLogs(contract, false);
          } catch (contractError) {
            const scopedId = this.toScopedId(contractNetwork, contract.id);
            this.database.logActivity('contract_skip', contract.name, contractError.message);
            this.emit('warning', { type: 'contract_skip', contractId: scopedId, error: contractError.message });
          }
        }

        if (!this.shouldStop) {
          this.setSyncPhase('hts', {
            current: 0,
            total: manifests.tokenIds.length,
            entity_type: 'token',
            entity_id: null,
            entity_name: null,
            last_timestamp: null,
          });
          try {
            await this.indexHtsTransfers(
              manifests.tokenIds,
              false,
              (progress) => this.setSyncPhaseProgress(progress)
            );
          } catch (htsError) {
            this.database.logActivity('hts_skip', null, htsError.message);
            this.emit('warning', { type: 'hts_skip', error: htsError.message });
          }
        }

        if (!this.shouldStop) {
          this.setSyncPhase('topics', {
            current: 0,
            total: manifests.topicIds.length,
            entity_type: 'topic',
            entity_id: null,
            entity_name: null,
            last_timestamp: null,
          });
          for (let topicIndex = 0; topicIndex < manifests.topicIds.length; topicIndex += 1) {
            if (this.shouldStop) break;
            const topicId = manifests.topicIds[topicIndex];
            this.setSyncPhaseProgress({
              current: topicIndex + 1,
              total: manifests.topicIds.length,
              entity_type: 'topic',
              entity_id: topicId,
              entity_name: topicId,
              last_timestamp: null,
            });
            try {
              await this.indexTopicMessages(topicId, false);
            } catch (topicError) {
              this.database.logActivity('topic_skip', topicId, topicError.message);
              this.emit('warning', { type: 'topic_skip', topicId, error: topicError.message });
            }
          }
        }

        if (!this.shouldStop) {
          this.setSyncPhase('idle', null);
          this.emit('listen_cycle', { nextPollMs: this.config.listenDelayMs });
          if (listenClient) {
            await listenClient.delayListenCycle();
          } else {
            await new Promise((resolve) => setTimeout(resolve, this.config.listenDelayMs));
          }
        }
      }

      return { success: true, stopped: true };
    } catch (error) {
      this.database.logActivity('listen_error', null, error.message);
      this.emit('error', { type: 'listen', error: error.message });
      return { success: false, error: error.message };
    } finally {
      this.isRunning = false;
      this.mode = 'idle';
      this.syncTarget = null;
      this.setSyncPhase('idle', null);
      this.database.updateStat('mode', 'idle');
      this.database.logActivity('listen_stop', null, 'Near-real-time polling loop stopped');
      this.emit('listen_stopped', {});
      await this.database.forceSave();
    }
  }

  stop() {
    if (!this.isRunning) {
      return { error: 'Indexer is not running' };
    }

    this.shouldStop = true;
    this.database.logActivity('stop_requested', null, 'Stop requested');
    this.emit('stopping', {});

    return { success: true, message: 'Stopping...' };
  }

  getRuntimeStatus() {
    return {
      isRunning: this.isRunning,
      mode: this.mode,
      network: this.config.network,
      networks: this.config.networks || [this.config.network],
      mirrorRestBaseUrl: this.config.mirrorRestBaseUrl,
      mirrorRestByNetwork: this.config.mirrorRestByNetwork || { [this.config.network]: this.config.mirrorRestBaseUrl },
      totalApiCalls: this.totalApiCalls,
      lastRateLimitTime: this.lastRateLimitTime ? new Date(this.lastRateLimitTime).toISOString() : null,
      sync: {
        target: this.syncTarget,
        phase: this.syncPhase,
        phase_started_at: this.syncPhaseStartedAt,
        phase_progress: this.syncPhaseProgress,
      },
      config: {
        pageLimit: this.config.pageLimit,
        requestDelayMs: this.config.requestDelayMs,
        backfillDelayMs: this.config.backfillDelayMs,
        listenDelayMs: this.config.listenDelayMs,
      },
      manifests: this.getManifestSummary(),
    };
  }

  getStatus() {
    const statusMetrics = this.database.getStatusMetrics();

    return {
      ...this.getRuntimeStatus(),
      database: statusMetrics.database,
      persistence: this.database.getPersistenceStatus(),
      stats: statusMetrics.stats,
      records_indexed: statusMetrics.records_indexed,
      status_age_ms: statusMetrics.status_age_ms,
      source: statusMetrics.source,
      syncStates: this.database.getAllSyncStates(),
    };
  }
}
