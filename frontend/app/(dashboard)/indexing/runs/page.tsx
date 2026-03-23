'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Database, Loader2, Play, Radio, RefreshCcw, Square, Waves } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  formatNumber,
  formatTime,
  getActivity,
  getAuthState,
  triggerIndexerAction,
  type ActivityRecord,
  type IndexerAction,
} from '@/lib/sefi-api';
import { useSharedStatus } from '@/lib/status-store';

type PageErrors = {
  activity: string | null;
};

const INITIAL_ERRORS: PageErrors = {
  activity: null,
};

export default function IndexRunsPage() {
  const sharedStatus = useSharedStatus();
  const status = sharedStatus.status;
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<IndexerAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<PageErrors>(INITIAL_ERRORS);
  const [activityStale, setActivityStale] = useState(false);
  const [activityUpdatedAt, setActivityUpdatedAt] = useState<string | null>(null);
  const [demoRestricted, setDemoRestricted] = useState(false);

  const activityRef = useRef<ActivityRecord[]>([]);

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setRefreshing(true);
    }

    const now = new Date().toISOString();
    const nextErrors: PageErrors = { ...INITIAL_ERRORS };

    const nextActivity = await getActivity(80).then(
      (value) => ({ ok: true as const, value }),
      (reason) => ({ ok: false as const, reason })
    );

    if (nextActivity.ok) {
      setActivity(nextActivity.value);
      setActivityStale(false);
      setActivityUpdatedAt(now);
    } else {
      nextErrors.activity = nextActivity.reason instanceof Error ? nextActivity.reason.message : 'Failed to load activity';
      setActivityStale(activityRef.current.length > 0);
    }

    setErrors(nextErrors);
    const visibleErrors = [nextErrors.activity].filter(Boolean) as string[];
    setError(visibleErrors.length > 0 ? visibleErrors.join(' | ') : null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh(false).catch(() => {
      // handled by state
    });
  }, [refresh]);

  const refreshAccessState = useCallback(() => {
    getAuthState()
      .then((auth) => {
        setDemoRestricted(Boolean(auth.demo_mode && !auth.full_access));
      })
      .catch(() => {
        // ignore auth state fetch failures for this page
      });
  }, []);

  useEffect(() => {
    refreshAccessState();
    const timer = setInterval(refreshAccessState, 10000);
    return () => clearInterval(timer);
  }, [refreshAccessState]);

  useEffect(() => {
    const timer = setInterval(() => {
      refresh(true).catch(() => {
        // handled by state
      });
    }, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  const triggerAction = useCallback(
    async (action: IndexerAction) => {
      if (demoRestricted) {
        setError('Run controls are disabled in demo mode. Login for full access.');
        return;
      }
      try {
        setActionLoading(action);
        setError(null);
        setNotice(null);
        const result = await triggerIndexerAction(action);
        setNotice(result.message || `${action} command accepted`);
        await refresh(false);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : `Failed to ${action}`);
      } finally {
        setActionLoading(null);
      }
    },
    [demoRestricted, refresh]
  );

  const problemEvents = useMemo(
    () =>
      activity.filter((entry) =>
        ['sync_error', 'listen_error', 'background_error', 'manifest_error'].includes(entry.event_type)
      ),
    [activity]
  );

  const skippedManifestWarning = useMemo(() => {
    if (!status?.manifests?.skipped?.length) return null;
    return status.manifests.skipped.map((item) => `${item.fileName}: ${item.reason}`).join(' | ');
  }, [status]);

  const phase = status?.sync?.phase || 'idle';
  const phaseProgress = status?.sync?.phase_progress;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Indexing / Runs</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Run Operations</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Start sync and near-real-time polling workflows, inspect the activity feed, and track operational warnings without leaving the dashboard.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Status updated: {formatTime(sharedStatus.lastUpdatedAt)} | Activity updated: {formatTime(activityUpdatedAt)}
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Run Controls</CardTitle>
            <CardDescription>Control indexer mode and targeted one-time sync passes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => triggerAction('sync')} disabled={demoRestricted || Boolean(actionLoading) || Boolean(status?.isRunning)}>
                {actionLoading === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Full Sync
              </Button>
              <Button variant="secondary" onClick={() => triggerAction('sync/contracts')} disabled={demoRestricted || Boolean(actionLoading) || Boolean(status?.isRunning)}>
                {actionLoading === 'sync/contracts' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />} Contracts
              </Button>
              <Button variant="secondary" onClick={() => triggerAction('sync/hts')} disabled={demoRestricted || Boolean(actionLoading) || Boolean(status?.isRunning)}>
                {actionLoading === 'sync/hts' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Waves className="h-4 w-4" />} HTS
              </Button>
              <Button variant="secondary" onClick={() => triggerAction('sync/topics')} disabled={demoRestricted || Boolean(actionLoading) || Boolean(status?.isRunning)}>
                {actionLoading === 'sync/topics' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Topics
              </Button>
              <Button variant="secondary" onClick={() => triggerAction('listen')} disabled={demoRestricted || Boolean(actionLoading) || Boolean(status?.isRunning)}>
                {actionLoading === 'listen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Start Polling
              </Button>
              <Button variant="destructive" onClick={() => triggerAction('stop')} disabled={demoRestricted || Boolean(actionLoading) || !Boolean(status?.isRunning)}>
                {actionLoading === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Stop
              </Button>
              <Button variant="destructive" onClick={() => triggerAction('reset')} disabled={demoRestricted || Boolean(actionLoading) || Boolean(status?.isRunning)}>
                {actionLoading === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />} Reset Data
              </Button>
              <Button variant="ghost" onClick={() => refresh(false)} disabled={loading || Boolean(actionLoading)}>
                <RefreshCcw className="h-4 w-4" /> Refresh
              </Button>
              {loading || refreshing ? <Badge variant="secondary">Loading...</Badge> : null}
              {notice ? <Badge variant="success">{notice}</Badge> : null}
              {error ? <Badge variant="warning">{error}</Badge> : null}
              {demoRestricted ? <Badge variant="warning">Demo mode: run controls disabled</Badge> : null}
              {sharedStatus.stale || activityStale ? <Badge variant="outline">Using stale data</Badge> : null}
            </div>
            <p className="text-xs text-zinc-500">
              Full sync remains contracts-first. Use targeted HTS/topics runs when you need those counters updated before contracts complete.
            </p>
            {sharedStatus.lastError ? <p className="text-xs text-amber-300">Status: {sharedStatus.lastError}</p> : null}
            {errors.activity ? <p className="text-xs text-amber-300">Activity: {errors.activity}</p> : null}
            {skippedManifestWarning ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                Skipped manifests for active networks {status?.networks?.length ? status.networks.join(', ') : status?.network}: {skippedManifestWarning}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Current Mode</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{status?.mode || 'idle'}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Sync Phase</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{phase}</p>
                {phaseProgress ? (
                  <p className="mt-1 text-xs text-zinc-400">
                    {phaseProgress.current}/{phaseProgress.total}
                    {phaseProgress.entity_name ? ` • ${phaseProgress.entity_name}` : ''}
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Total API Calls</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{formatNumber(status?.totalApiCalls)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Last Rate Limit</p>
                <p className="mt-1 text-sm font-medium text-zinc-300">{formatTime(status?.lastRateLimitTime)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Warnings</CardTitle>
            <CardDescription>Recent errors and retry-relevant events.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {problemEvents.length === 0 ? (
              <p className="text-sm text-zinc-400">No recent error events.</p>
            ) : (
              problemEvents.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-300">{entry.event_type}</p>
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                  </div>
                  <p className="mt-2 text-sm text-zinc-300">{entry.message}</p>
                  <p className="mt-1 text-xs text-zinc-500">{entry.timestamp}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Activity Stream</CardTitle>
            <CardDescription>Operational event log emitted by the SeFi backend.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-zinc-500">
                      No activity events yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  activity.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs text-zinc-300">{entry.event_type}</TableCell>
                      <TableCell className="text-zinc-400">{entry.entity_name || '-'}</TableCell>
                      <TableCell>{entry.message}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-500">{entry.timestamp}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
