import { parseJsonLosslessInt64 } from './json-lossless.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MirrorNodeClient {
  constructor({ config, fetchImpl = fetch, onRequest = () => {}, onRateLimit = () => {} }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.onRequest = onRequest;
    this.onRateLimit = onRateLimit;
    this.lastRateLimitAt = 0;
    this.baseUrlPool = this.buildBaseUrlPool();
    this.baseUrlIndex = 0;
    this.baseUrlOrigins = this.collectOrigins(this.baseUrlPool);
    this.poolBenchmarked = false;
    this.poolBenchmarkPromise = null;
  }

  buildBaseUrlPool() {
    const configuredPool = Array.isArray(this.config.mirrorRestPool)
      ? this.config.mirrorRestPool
      : [];
    const fallback = this.config.mirrorRestBaseUrl ? [this.config.mirrorRestBaseUrl] : [];
    const merged = [...configuredPool, ...fallback]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    const unique = Array.from(new Set(merged));
    return unique.length > 0 ? unique : ['https://mainnet-public.mirrornode.hedera.com'];
  }

  collectOrigins(pool) {
    return new Set(
      pool
        .map((baseUrl) => {
          try {
            return new URL(baseUrl).origin;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    );
  }

  async ensureBaseUrlPoolRanked() {
    if (!this.config.mirrorPoolProbeEnabled) return;
    if (this.poolBenchmarked) return;
    if (this.baseUrlPool.length <= 1) {
      this.poolBenchmarked = true;
      return;
    }

    if (this.poolBenchmarkPromise) {
      await this.poolBenchmarkPromise;
      return;
    }

    this.poolBenchmarkPromise = this.rankBaseUrlPoolByLatency()
      .catch(() => {})
      .finally(() => {
        this.poolBenchmarked = true;
        this.poolBenchmarkPromise = null;
      });
    await this.poolBenchmarkPromise;
  }

  async rankBaseUrlPoolByLatency() {
    const timeoutMs = Math.max(
      250,
      Math.min(
        Number(this.config.mirrorPoolProbeTimeoutMs) || 1500,
        Number(this.config.mirrorRequestTimeoutMs) || 15000
      )
    );
    const probePath = this.config.mirrorPoolProbePath || '/api/v1/network/nodes?limit=1';
    const samplePool = [...this.baseUrlPool];

    const results = await Promise.all(
      samplePool.map(async (baseUrl, index) => {
        let probeUrl;
        try {
          probeUrl = new URL(probePath, baseUrl).toString();
        } catch {
          probeUrl = `${baseUrl}/api/v1/network/nodes?limit=1`;
        }
        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort(new Error(`Mirror pool probe timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        try {
          this.onRequest();
          const response = await this.fetchImpl(probeUrl, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Probe returned HTTP ${response.status}`);
          }

          return {
            ok: true,
            baseUrl,
            index,
            latencyMs: Date.now() - startedAt,
          };
        } catch {
          return {
            ok: false,
            baseUrl,
            index,
            latencyMs: Number.POSITIVE_INFINITY,
          };
        } finally {
          clearTimeout(timeout);
        }
      })
    );

    const successful = results
      .filter((result) => result.ok)
      .sort((left, right) => left.latencyMs - right.latencyMs || left.index - right.index);

    if (successful.length === 0) {
      return;
    }

    const failed = results
      .filter((result) => !result.ok)
      .sort((left, right) => left.index - right.index);

    const rankedPool = [...successful, ...failed].map((result) => result.baseUrl);
    this.baseUrlPool = rankedPool;
    this.baseUrlIndex = 0;
    this.baseUrlOrigins = this.collectOrigins(this.baseUrlPool);
  }

  getActiveBaseUrl() {
    if (this.baseUrlPool.length === 0) return this.config.mirrorRestBaseUrl;
    if (this.baseUrlIndex < 0 || this.baseUrlIndex >= this.baseUrlPool.length) {
      this.baseUrlIndex = 0;
    }
    return this.baseUrlPool[this.baseUrlIndex];
  }

  rotateBaseUrl() {
    if (this.baseUrlPool.length <= 1) return;
    this.baseUrlIndex = (this.baseUrlIndex + 1) % this.baseUrlPool.length;
  }

  toAbsoluteUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    const raw = String(pathOrUrl);
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const parsed = new URL(raw);
        if (!this.baseUrlOrigins.has(parsed.origin)) {
          return raw;
        }
        const activeBaseUrl = this.getActiveBaseUrl();
        const remapped = new URL(`${parsed.pathname}${parsed.search}`, activeBaseUrl);
        return remapped.toString();
      } catch {
        return raw;
      }
    }
    return `${this.getActiveBaseUrl()}${raw}`;
  }

  buildUrl(routePath, params = {}) {
    const url = new URL(routePath, this.getActiveBaseUrl());
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async fetchJson(url) {
    await this.ensureBaseUrlPoolRanked();
    const timeoutMs = Math.max(1000, Number(this.config.mirrorRequestTimeoutMs) || 15000);
    let lastAbsoluteUrl = this.toAbsoluteUrl(url);

    if (this.lastRateLimitAt > 0) {
      const elapsed = Date.now() - this.lastRateLimitAt;
      if (elapsed < this.config.rateLimitCooldownMs) {
        await sleep(this.config.rateLimitCooldownMs - elapsed);
      }
    }

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt += 1) {
      const absoluteUrl = this.toAbsoluteUrl(url);
      lastAbsoluteUrl = absoluteUrl;
      this.onRequest();

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error(`Mirror node request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      let response;
      try {
        response = await this.fetchImpl(absoluteUrl, {
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeout);

        const timedOut = error?.name === 'AbortError';
        if (attempt === this.config.maxRetries) {
          throw new Error(
            timedOut
              ? `Mirror node request timed out after ${timeoutMs}ms for ${absoluteUrl}`
              : `Mirror node request failed for ${absoluteUrl}: ${error?.message || error}`
          );
        }

        this.rotateBaseUrl();
        await sleep(this.config.retryDelayMs * attempt);
        continue;
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 429) {
        this.lastRateLimitAt = Date.now();
        this.onRateLimit(this.lastRateLimitAt);

        if (attempt === this.config.maxRetries) {
          throw new Error(`Rate limited at ${absoluteUrl}`);
        }

        this.rotateBaseUrl();
        await sleep(this.config.rateLimitCooldownMs);
        continue;
      }

      if (!response.ok) {
        if (attempt === this.config.maxRetries) {
          throw new Error(`Mirror node returned HTTP ${response.status} for ${absoluteUrl}`);
        }

        this.rotateBaseUrl();
        await sleep(this.config.retryDelayMs * attempt);
        continue;
      }

      const bodyText = await response.text();
      try {
        return parseJsonLosslessInt64(bodyText);
      } catch (error) {
        throw new Error(`Mirror node returned invalid JSON for ${absoluteUrl}: ${error?.message || error}`);
      }
    }

    throw new Error(`Failed to fetch ${lastAbsoluteUrl}`);
  }

  async fetchContractLogs(contractId, options = {}) {
    const url = this.buildUrl(`/api/v1/contracts/${contractId}/results/logs`, {
      order: 'asc',
      limit: this.config.pageLimit,
      timestamp: options.timestamp,
      index: options.index,
    });
    return this.fetchJson(url);
  }

  async fetchTransactions(options = {}) {
    const url = this.buildUrl('/api/v1/transactions', {
      order: 'asc',
      limit: this.config.pageLimit,
      transactiontype: 'CRYPTOTRANSFER',
      timestamp: options.timestamp,
    });
    return this.fetchJson(url);
  }

  async fetchTopicMessages(topicId, options = {}) {
    const url = this.buildUrl(`/api/v1/topics/${topicId}/messages`, {
      order: 'asc',
      limit: this.config.pageLimit,
      timestamp: options.timestamp,
      sequencenumber: options.sequencenumber,
    });
    return this.fetchJson(url);
  }

  async fetchNextPage(nextLink) {
    if (!nextLink) {
      return null;
    }
    const absoluteUrl = this.toAbsoluteUrl(nextLink);
    return this.fetchJson(absoluteUrl);
  }

  async delayForMode(isBackfill) {
    await sleep(isBackfill ? this.config.backfillDelayMs : this.config.requestDelayMs);
  }

  async delayListenCycle() {
    await sleep(this.config.listenDelayMs);
  }
}
