'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getDerivedStatus,
  listDerivedRuns,
  type DerivedPipelineRun,
  type DerivedStatusResponse,
} from '@/lib/sefi-api';

function navClass(active: boolean) {
  return active
    ? 'rounded-md border border-white/30 bg-white/10 px-3 py-1.5 text-xs text-zinc-100'
    : 'rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-400 hover:border-white/20 hover:text-zinc-100';
}

export default function DerivedRunsPage() {
  const [status, setStatus] = useState<DerivedStatusResponse | null>(null);
  const [runs, setRuns] = useState<DerivedPipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [statusPayload, runsPayload] = await Promise.all([getDerivedStatus(), listDerivedRuns(200)]);
      setStatus(statusPayload);
      setRuns(runsPayload.records);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load derived runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      load().catch(() => {
        // handled in state
      });
    }, 12000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Derived Tables</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Run History</h1>
        <p className="mt-2 max-w-4xl text-sm text-zinc-400">
          Monitor pipeline execution, lag, and failures for incremental + reconcile materialization.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/derived/pipelines" className={navClass(false)}>Pipelines</Link>
          <Link href="/derived/sources" className={navClass(false)}>Sources</Link>
          <Link href="/derived/runs" className={navClass(true)}>Runs</Link>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => load()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          {loading ? <Badge variant="secondary">Loading...</Badge> : <Badge variant="outline">{runs.length} runs</Badge>}
          {status ? <Badge variant="outline">Pipelines {status.pipelines_enabled}/{status.pipelines_total}</Badge> : null}
          {status ? <Badge variant="outline">Failed {status.failed_runs}</Badge> : null}
          {status ? <Badge variant="outline">Lag {status.max_lag_ms === null ? 'n/a' : `${Math.round(status.max_lag_ms / 1000)}s`}</Badge> : null}
          {error ? <Badge variant="warning">{error}</Badge> : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Derived runtime health and schedule metadata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-300">
            <p><span className="text-zinc-500">Enabled:</span> {status?.enabled ? 'yes' : 'no'}</p>
            <p><span className="text-zinc-500">Initialized:</span> {status?.initialized_at || '-'}</p>
            <p><span className="text-zinc-500">Last Realtime:</span> {status?.last_realtime_run_at || '-'}</p>
            <p><span className="text-zinc-500">Last Reconcile:</span> {status?.last_reconcile_at || '-'}</p>
            <p><span className="text-zinc-500">Batch Size:</span> {status?.batch_size || '-'}</p>
            <p><span className="text-zinc-500">Cron:</span> {status?.reconcile_cron || '-'}</p>
            <p><span className="text-zinc-500">Last Error:</span> {status?.last_error || '-'}</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline Runs</CardTitle>
            <CardDescription>Newest-first run stream across all pipelines.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">No runs yet.</div>
            ) : (
              <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={run.status === 'success' ? 'success' : run.status === 'failed' ? 'warning' : 'secondary'}>
                        {run.status}
                      </Badge>
                      <Badge variant="outline">{run.trigger_source}</Badge>
                      <Badge variant="secondary">pipeline: {run.pipeline_id}</Badge>
                      <span className="text-xs text-zinc-500">{run.started_at || '-'}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      rows: {run.rows_read} read / {run.rows_written} written
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      cursor: {run.cursor_before || '-'} → {run.cursor_after || '-'}
                    </p>
                    {run.error ? <p className="mt-1 text-xs text-rose-300">{run.error}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
