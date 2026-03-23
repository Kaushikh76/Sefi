'use client';

import { useSyncExternalStore } from 'react';
import { ensureApiSession, getStatus, getStatusStreamUrl, type StatusResponse } from '@/lib/sefi-api';

export type ServiceState = 'starting' | 'up' | 'stale' | 'degraded' | 'down';

export type SharedStatusSnapshot = {
  phase: 'starting' | 'ready';
  status: StatusResponse | null;
  backend: ServiceState;
  cube: ServiceState;
  stale: boolean;
  source: 'none' | 'storage' | 'poll' | 'stream';
  lastUpdatedAt: string | null;
  lastError: string | null;
  online: boolean;
};

const STORAGE_KEY = 'sefi.status.snapshot.v1';
const STALE_AFTER_MS = 25000;
const POLL_FOREGROUND_MS = 6000;
const POLL_BACKGROUND_MS = 20000;
const POLL_MAX_BACKOFF_MS = 30000;

function mapStatusToServiceState(value: string | null | undefined): ServiceState {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'up' || normalized === 'ok') return 'up';
  if (normalized === 'degraded') return 'degraded';
  if (normalized === 'down') return 'down';
  if (normalized === 'stale') return 'stale';
  return 'starting';
}

function deriveBackendState(status: StatusResponse | null, stale: boolean): ServiceState {
  if (stale) return 'stale';
  if (!status) return 'starting';
  return mapStatusToServiceState(status.backend_status || status.db_status || status.mode);
}

function deriveCubeState(status: StatusResponse | null, stale: boolean): ServiceState {
  if (stale) return 'stale';
  if (!status) return 'starting';
  const cubeStatus = status.cube_status || status.cube_health?.status || status.cube?.status;
  return mapStatusToServiceState(cubeStatus);
}

function nowIso() {
  return new Date().toISOString();
}

function parseStoredSnapshot(raw: string | null): SharedStatusSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      status?: StatusResponse;
      lastUpdatedAt?: string;
      source?: SharedStatusSnapshot['source'];
    };
    const status = parsed.status || null;
    const stale = true;
    return {
      phase: status ? 'ready' : 'starting',
      status,
      backend: deriveBackendState(status, stale),
      cube: deriveCubeState(status, stale),
      stale,
      source: status ? parsed.source || 'storage' : 'none',
      lastUpdatedAt: parsed.lastUpdatedAt || null,
      lastError: null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    };
  } catch {
    return null;
  }
}

function getVisibilityPollInterval() {
  if (typeof document === 'undefined') return POLL_FOREGROUND_MS;
  return document.visibilityState === 'hidden' ? POLL_BACKGROUND_MS : POLL_FOREGROUND_MS;
}

class StatusStore {
  snapshot: SharedStatusSnapshot = {
    phase: 'starting',
    status: null,
    backend: 'starting',
    cube: 'starting',
    stale: false,
    source: 'none',
    lastUpdatedAt: null,
    lastError: null,
    online: true,
  };

  listeners = new Set<() => void>();
  started = false;
  pollTimer: ReturnType<typeof setTimeout> | null = null;
  staleTimer: ReturnType<typeof setInterval> | null = null;
  streamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  eventSource: EventSource | null = null;
  pollBackoffMs = 0;
  lastUpdateMs = 0;

  getSnapshot = () => this.snapshot;

  emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  setSnapshot(next: SharedStatusSnapshot) {
    this.snapshot = next;
    this.lastUpdateMs = next.lastUpdatedAt ? new Date(next.lastUpdatedAt).getTime() : this.lastUpdateMs;
    this.emit();
  }

  persistSnapshot() {
    if (typeof window === 'undefined') return;
    if (!this.snapshot.status) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      status: this.snapshot.status,
      lastUpdatedAt: this.snapshot.lastUpdatedAt,
      source: this.snapshot.source,
    }));
  }

  applyStatus(status: StatusResponse, source: SharedStatusSnapshot['source']) {
    const stale = false;
    const next: SharedStatusSnapshot = {
      phase: 'ready',
      status,
      backend: deriveBackendState(status, stale),
      cube: deriveCubeState(status, stale),
      stale,
      source,
      lastUpdatedAt: nowIso(),
      lastError: null,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    };
    this.pollBackoffMs = 0;
    this.setSnapshot(next);
    this.persistSnapshot();
  }

  markStale(errorMessage?: string | null) {
    const stale = true;
    const status = this.snapshot.status;
    const backend = status ? deriveBackendState(status, stale) : 'down';
    const cube = status ? deriveCubeState(status, stale) : 'down';
    const next: SharedStatusSnapshot = {
      ...this.snapshot,
      phase: status ? 'ready' : 'starting',
      backend,
      cube,
      stale,
      lastError: errorMessage || this.snapshot.lastError,
      online: typeof navigator !== 'undefined' ? navigator.onLine : this.snapshot.online,
    };
    this.setSnapshot(next);
  }

  schedulePoll(delayMs: number) {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.pollTimer = setTimeout(() => {
      this.pollStatus().catch(() => {
        // handled by state transitions
      });
    }, Math.max(250, delayMs));
  }

  async pollStatus() {
    try {
      const status = await getStatus();
      this.applyStatus(status, 'poll');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Status poll failed';
      this.markStale(message);
      const base = this.pollBackoffMs > 0 ? Math.min(this.pollBackoffMs * 2, POLL_MAX_BACKOFF_MS) : 1000;
      const jitter = Math.floor(Math.random() * 400);
      this.pollBackoffMs = base;
      this.schedulePoll(base + jitter);
      return;
    }

    this.schedulePoll(getVisibilityPollInterval());
  }

  connectStream() {
    if (typeof window === 'undefined') return;
    if (!navigator.onLine) return;
    if (this.eventSource) return;

    const source = new EventSource(getStatusStreamUrl(), { withCredentials: true });
    this.eventSource = source;

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StatusResponse;
        this.applyStatus(parsed, 'stream');
      } catch {
        // ignore malformed stream messages
      }
    };

    source.onerror = () => {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      this.markStale(this.snapshot.lastError || 'Status stream disconnected');
      this.schedulePoll(800);
      this.scheduleStreamReconnect();
    };
  }

  scheduleStreamReconnect() {
    if (this.streamReconnectTimer) {
      clearTimeout(this.streamReconnectTimer);
    }
    const delayMs = Math.min(12000, Math.max(2000, this.pollBackoffMs || 2000));
    this.streamReconnectTimer = setTimeout(() => {
      this.streamReconnectTimer = null;
      this.connectStream();
    }, delayMs);
  }

  watchStaleness() {
    if (this.staleTimer) return;
    this.staleTimer = setInterval(() => {
      if (!this.snapshot.status || !this.lastUpdateMs) return;
      if (Date.now() - this.lastUpdateMs > STALE_AFTER_MS && !this.snapshot.stale) {
        this.markStale(this.snapshot.lastError || 'Using last-known status snapshot');
      }
    }, 2000);
  }

  onOnline = () => {
    const next = {
      ...this.snapshot,
      online: true,
    };
    this.setSnapshot(next);
    this.connectStream();
    this.schedulePoll(200);
  };

  onOffline = () => {
    const next = {
      ...this.snapshot,
      online: false,
    };
    this.setSnapshot(next);
    this.markStale('Network offline');
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  };

  onVisibilityChange = () => {
    if (!this.snapshot.status) return;
    this.schedulePoll(getVisibilityPollInterval());
  };

  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    const stored = parseStoredSnapshot(window.localStorage.getItem(STORAGE_KEY));
    if (stored) {
      this.setSnapshot(stored);
    } else {
      this.setSnapshot({
        ...this.snapshot,
        online: navigator.onLine,
      });
    }

    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.watchStaleness();

    ensureApiSession()
      .catch(() => {
        // fallback to header-token mode
      })
      .finally(() => {
        this.connectStream();
        this.schedulePoll(100);
      });
  }

  subscribe(listener: () => void) {
    this.start();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const sharedStatusStore = new StatusStore();
const subscribe = sharedStatusStore.subscribe.bind(sharedStatusStore);
const getSnapshot = sharedStatusStore.getSnapshot;

export function useSharedStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function formatServiceState(state: ServiceState) {
  if (state === 'up') return 'Up';
  if (state === 'degraded') return 'Degraded';
  if (state === 'down') return 'Down';
  if (state === 'stale') return 'Stale';
  return 'Starting';
}

export function serviceStateBadgeVariant(state: ServiceState): 'success' | 'warning' | 'outline' | 'secondary' {
  if (state === 'up') return 'success';
  if (state === 'degraded' || state === 'down') return 'warning';
  if (state === 'stale') return 'outline';
  return 'secondary';
}
