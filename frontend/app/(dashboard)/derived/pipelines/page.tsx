'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CopyPlus, Eye, Loader2, Play, Plus, RefreshCcw, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  cloneDerivedPipeline,
  createDerivedPipeline,
  deleteDerivedPipeline,
  getDerivedStatus,
  listDerivedPipelineRuns,
  listDerivedPipelines,
  previewDerivedPipeline,
  runAllDerivedPipelines,
  runDerivedPipeline,
  updateDerivedPipeline,
  type DerivedPipeline,
  type DerivedPipelineRun,
  type DerivedStatusResponse,
} from '@/lib/sefi-api';

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function navClass(active: boolean) {
  return active
    ? 'rounded-md border border-white/30 bg-white/10 px-3 py-1.5 text-xs text-zinc-100'
    : 'rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-400 hover:border-white/20 hover:text-zinc-100';
}

function defaultSpec() {
  return {
    kind: 'sql_transform',
    source_sql: 'SELECT id, contract_id, event_name, timestamp FROM contract_logs WHERE id > {{cursor}} ORDER BY id ASC LIMIT {{limit}}',
    cursor_column: 'id',
    key_columns: ['id'],
    column_mappings: {
      id: '$id',
      contract_id: '$contract_id',
      event_name: '$event_name',
      event_timestamp: '$timestamp',
    },
    target_columns: [
      { name: 'id', type: 'INTEGER', primary_key: true },
      { name: 'contract_id', type: 'TEXT' },
      { name: 'event_name', type: 'TEXT' },
      { name: 'event_timestamp', type: 'TEXT' },
    ],
  };
}

function defaultSchedule() {
  return {
    mode: 'manual',
  };
}

export default function DerivedPipelinesPage() {
  const [status, setStatus] = useState<DerivedStatusResponse | null>(null);
  const [pipelines, setPipelines] = useState<DerivedPipeline[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<DerivedPipelineRun[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [realtimeEnabled, setRealtimeEnabled] = useState(true);
  const [targetTable, setTargetTable] = useState('');
  const [specText, setSpecText] = useState(pretty(defaultSpec()));
  const [scheduleText, setScheduleText] = useState(pretty(defaultSchedule()));
  const [builderSourceSql, setBuilderSourceSql] = useState(defaultSpec().source_sql);
  const [builderCursorColumn, setBuilderCursorColumn] = useState(defaultSpec().cursor_column);
  const [builderKeyColumns, setBuilderKeyColumns] = useState(defaultSpec().key_columns.join(', '));
  const [builderScheduleMode, setBuilderScheduleMode] = useState('manual');
  const [builderScheduleCron, setBuilderScheduleCron] = useState('');

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedId) || null,
    [pipelines, selectedId]
  );

  const parsedSpec = useMemo(() => {
    try {
      const parsed = JSON.parse(specText);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }, [specText]);

  const parsedSchedule = useMemo(() => {
    try {
      const parsed = JSON.parse(scheduleText);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }, [scheduleText]);

  const resetForm = useCallback(() => {
    setSelectedId(null);
    setName('');
    setSlug('');
    setDescription('');
    setEnabled(true);
    setRealtimeEnabled(true);
    setTargetTable('derived_table_example');
    setSpecText(pretty(defaultSpec()));
    setScheduleText(pretty(defaultSchedule()));
    setBuilderSourceSql(defaultSpec().source_sql);
    setBuilderCursorColumn(defaultSpec().cursor_column);
    setBuilderKeyColumns(defaultSpec().key_columns.join(', '));
    setBuilderScheduleMode('manual');
    setBuilderScheduleCron('');
    setPreviewRows([]);
    setRuns([]);
  }, []);

  const loadPipelines = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [pipelinePayload, statusPayload] = await Promise.all([listDerivedPipelines(), getDerivedStatus()]);
      setPipelines(pipelinePayload.records);
      setStatus(statusPayload);
      if (!selectedId && pipelinePayload.records.length > 0) {
        setSelectedId(pipelinePayload.records[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load derived pipelines');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadRuns = useCallback(async (pipelineId: string) => {
    try {
      const payload = await listDerivedPipelineRuns(pipelineId, 30);
      setRuns(payload.records);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (!selectedPipeline) {
      return;
    }

    setName(selectedPipeline.name);
    setSlug(selectedPipeline.slug);
    setDescription(selectedPipeline.description || '');
    setEnabled(selectedPipeline.enabled);
    setRealtimeEnabled(selectedPipeline.realtime_enabled);
    setTargetTable(selectedPipeline.target_table);
    setSpecText(pretty(selectedPipeline.spec || {}));
    setScheduleText(pretty(selectedPipeline.schedule || {}));
    const spec = selectedPipeline.spec && typeof selectedPipeline.spec === 'object' ? selectedPipeline.spec : {};
    const schedule =
      selectedPipeline.schedule && typeof selectedPipeline.schedule === 'object'
        ? selectedPipeline.schedule
        : {};
    if (spec.kind === 'sql_transform') {
      setBuilderSourceSql(String(spec.source_sql || ''));
      setBuilderCursorColumn(String(spec.cursor_column || ''));
      setBuilderKeyColumns(Array.isArray(spec.key_columns) ? spec.key_columns.join(', ') : '');
    } else {
      setBuilderSourceSql('');
      setBuilderCursorColumn('');
      setBuilderKeyColumns('');
    }
    setBuilderScheduleMode(String(schedule.mode || 'manual'));
    setBuilderScheduleCron(String(schedule.cron || ''));
    setPreviewRows([]);
    loadRuns(selectedPipeline.id);
  }, [loadRuns, selectedPipeline]);

  const syncBuilderToJson = useCallback(() => {
    if (!parsedSpec || !parsedSchedule) {
      setError('Fix JSON syntax before applying builder values');
      return;
    }

    const nextSpec =
      parsedSpec.kind === 'sql_transform'
        ? {
            ...parsedSpec,
            source_sql: builderSourceSql,
            cursor_column: builderCursorColumn || null,
            key_columns: builderKeyColumns
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean),
          }
        : parsedSpec;

    const nextSchedule = {
      ...parsedSchedule,
      mode: builderScheduleMode || 'manual',
    } as Record<string, unknown>;
    if (builderScheduleCron.trim()) {
      nextSchedule.cron = builderScheduleCron.trim();
    } else {
      delete nextSchedule.cron;
    }

    setSpecText(pretty(nextSpec));
    setScheduleText(pretty(nextSchedule));
    setNotice('Builder values synced to JSON');
  }, [
    builderCursorColumn,
    builderKeyColumns,
    builderScheduleCron,
    builderScheduleMode,
    builderSourceSql,
    parsedSchedule,
    parsedSpec,
  ]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!targetTable.trim()) {
      setError('Target table is required');
      return;
    }
    if (!parsedSpec) {
      setError('Spec must be valid JSON');
      return;
    }
    if (!parsedSchedule) {
      setError('Schedule must be valid JSON');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setNotice(null);

      if (selectedPipeline) {
        const updated = await updateDerivedPipeline(selectedPipeline.id, {
          name,
          slug,
          description,
          enabled,
          realtime_enabled: realtimeEnabled,
          target_table: targetTable,
          schedule: parsedSchedule,
          spec: parsedSpec,
        });
        setPipelines((current) => current.map((pipeline) => (pipeline.id === updated.id ? updated : pipeline)));
        setNotice(`Updated pipeline ${updated.slug}`);
      } else {
        const created = await createDerivedPipeline({
          name,
          slug,
          description,
          enabled,
          realtime_enabled: realtimeEnabled,
          target_table: targetTable,
          schedule: parsedSchedule,
          spec: parsedSpec,
        });
        setPipelines((current) => [created, ...current]);
        setSelectedId(created.id);
        setNotice(`Created pipeline ${created.slug}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save pipeline');
    } finally {
      setSaving(false);
    }
  }, [
    description,
    enabled,
    name,
    parsedSchedule,
    parsedSpec,
    realtimeEnabled,
    selectedPipeline,
    slug,
    targetTable,
  ]);

  const handleDelete = useCallback(async () => {
    if (!selectedPipeline) return;
    if (selectedPipeline.is_system) {
      setError('System pipelines cannot be deleted');
      return;
    }

    const confirmed = window.confirm(`Delete derived pipeline "${selectedPipeline.slug}"?`);
    if (!confirmed) return;

    try {
      setDeleting(true);
      setError(null);
      await deleteDerivedPipeline(selectedPipeline.id);
      setPipelines((current) => current.filter((pipeline) => pipeline.id !== selectedPipeline.id));
      resetForm();
      setNotice(`Deleted pipeline ${selectedPipeline.slug}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete pipeline');
    } finally {
      setDeleting(false);
    }
  }, [resetForm, selectedPipeline]);

  const handleRun = useCallback(async () => {
    if (!selectedPipeline) return;
    try {
      setRunning(true);
      setError(null);
      setNotice(null);
      const result = await runDerivedPipeline(selectedPipeline.id, { limit: 2000 });
      const latestRun = result.run;
      if (latestRun) {
        setRuns((current) => [latestRun, ...current].slice(0, 30));
      }
      setNotice(
        `Run complete (${result.run?.rows_read || 0} read / ${result.run?.rows_written || 0} written)`
      );
      await loadPipelines();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run pipeline');
    } finally {
      setRunning(false);
    }
  }, [loadPipelines, selectedPipeline]);

  const handleRunAll = useCallback(async () => {
    try {
      setRunningAll(true);
      setError(null);
      setNotice(null);
      const result = await runAllDerivedPipelines({
        limit: 2000,
        trigger_source: 'manual_run_all_ui',
      });
      await loadPipelines();
      if (selectedPipeline) {
        await loadRuns(selectedPipeline.id);
      }
      if (result.failed_count > 0) {
        setError(`Run all finished with ${result.failed_count} failure(s). Check Runs for details.`);
      }
      setNotice(`Run all complete (${result.success_count}/${result.total} succeeded)`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run all pipelines');
    } finally {
      setRunningAll(false);
    }
  }, [loadPipelines, loadRuns, selectedPipeline]);

  const handlePreview = useCallback(async () => {
    if (!selectedPipeline) return;
    try {
      setPreviewing(true);
      setError(null);
      const result = await previewDerivedPipeline(selectedPipeline.id, { limit: 25 });
      setPreviewRows(result.preview_rows || []);
      setNotice(`Preview generated (${result.preview_rows.length} rows)`);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to preview pipeline');
    } finally {
      setPreviewing(false);
    }
  }, [selectedPipeline]);

  const handleClone = useCallback(async () => {
    if (!selectedPipeline) return;
    try {
      setCloning(true);
      setError(null);
      setNotice(null);
      const clone = await cloneDerivedPipeline(selectedPipeline.id, {
        name: `${selectedPipeline.name} (Custom)`,
        target_table: `${selectedPipeline.target_table}_custom`,
      });
      setPipelines((current) => [clone, ...current]);
      setSelectedId(clone.id);
      setNotice(`Created editable clone ${clone.slug}`);
      await loadRuns(clone.id);
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : 'Failed to clone pipeline');
    } finally {
      setCloning(false);
    }
  }, [loadRuns, selectedPipeline]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Derived Tables</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Pipeline Workspace</h1>
        <p className="mt-2 max-w-4xl text-sm text-zinc-400">
          Build reusable subtable pipelines from indexed data with optional external enrichment sources.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/derived/pipelines" className={navClass(true)}>Pipelines</Link>
          <Link href="/derived/sources" className={navClass(false)}>Sources</Link>
          <Link href="/derived/runs" className={navClass(false)}>Runs</Link>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => loadPipelines()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="secondary" onClick={() => resetForm()}>
            <Plus className="h-4 w-4" /> New Pipeline
          </Button>
          <Button onClick={() => handleRunAll()} disabled={runningAll || pipelines.length === 0}>
            {runningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run All
          </Button>
          {loading ? <Badge variant="secondary">Loading...</Badge> : <Badge variant="outline">{pipelines.length} pipelines</Badge>}
          {status ? <Badge variant="outline">Lag {status.max_lag_ms === null ? 'n/a' : `${Math.round(status.max_lag_ms / 1000)}s`}</Badge> : null}
          {notice ? <Badge variant="success">{notice}</Badge> : null}
          {error ? <Badge variant="warning">{error}</Badge> : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipelines</CardTitle>
            <CardDescription>Built-ins are locked defaults and still runnable.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pipelines.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">No pipelines found.</div>
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {pipelines.map((pipeline) => (
                  <button
                    key={pipeline.id}
                    type="button"
                    onClick={() => setSelectedId(pipeline.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedId === pipeline.id
                        ? 'border-white/25 bg-white/10'
                        : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30'
                    }`}
                  >
                    <p className="font-mono text-xs text-zinc-100">{pipeline.slug}</p>
                    <p className="mt-1 text-xs text-zinc-400">{pipeline.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant={pipeline.enabled ? 'success' : 'warning'}>{pipeline.enabled ? 'enabled' : 'disabled'}</Badge>
                      {pipeline.is_system ? <Badge variant="outline">system</Badge> : null}
                      {pipeline.last_run_status ? <Badge variant="secondary">{pipeline.last_run_status}</Badge> : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Pipeline Editor</CardTitle>
            <CardDescription>Define source SQL or builtin spec, target table, and scheduling behavior.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Pipeline name"
                className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
              />
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="pipeline-slug"
                className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 font-mono text-sm text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
              className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
            />

            <input
              value={targetTable}
              onChange={(event) => setTargetTable(event.target.value)}
              placeholder="target_table"
              className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 font-mono text-sm text-zinc-200 outline-none focus:border-white/30"
            />

            <div className="grid gap-2 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                Enabled
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                Realtime
                <input
                  type="checkbox"
                  checked={realtimeEnabled}
                  onChange={(event) => setRealtimeEnabled(event.target.checked)}
                />
              </label>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Guided Builder</p>
              <p className="mb-3 text-xs text-zinc-500">
                Use this for quick editing, then sync into JSON. Advanced options still live in raw JSON editors.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={builderScheduleMode}
                  onChange={(event) => setBuilderScheduleMode(event.target.value)}
                  className="h-10 rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200"
                >
                  <option value="manual">manual</option>
                  <option value="realtime_with_reconcile">realtime_with_reconcile</option>
                  <option value="scheduled">scheduled</option>
                </select>
                <input
                  value={builderScheduleCron}
                  onChange={(event) => setBuilderScheduleCron(event.target.value)}
                  placeholder="cron (optional) e.g. 0 2 * * *"
                  className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
                />
              </div>
              <textarea
                value={builderSourceSql}
                onChange={(event) => setBuilderSourceSql(event.target.value)}
                rows={5}
                placeholder="source SQL (sql_transform pipelines)"
                className="mt-3 w-full rounded-md border border-white/15 bg-black/35 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
              />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input
                  value={builderCursorColumn}
                  onChange={(event) => setBuilderCursorColumn(event.target.value)}
                  placeholder="cursor column (e.g. id)"
                  className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
                />
                <input
                  value={builderKeyColumns}
                  onChange={(event) => setBuilderKeyColumns(event.target.value)}
                  placeholder="key columns comma-separated"
                  className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
                />
              </div>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => syncBuilderToJson()}>
                  Sync Builder to JSON
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Spec JSON</p>
              <textarea
                value={specText}
                onChange={(event) => setSpecText(event.target.value)}
                rows={12}
                className="w-full rounded-md border border-white/15 bg-black/35 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Schedule JSON</p>
              <textarea
                value={scheduleText}
                onChange={(event) => setScheduleText(event.target.value)}
                rows={4}
                className="w-full rounded-md border border-white/15 bg-black/35 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleSave()} disabled={saving || !parsedSpec || !parsedSchedule}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </Button>
              <Button variant="secondary" onClick={() => handleClone()} disabled={!selectedPipeline || cloning}>
                {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CopyPlus className="h-4 w-4" />} Clone
              </Button>
              <Button onClick={() => handleRun()} disabled={!selectedPipeline || running || runningAll}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
              </Button>
              <Button variant="secondary" onClick={() => handlePreview()} disabled={!selectedPipeline || previewing}>
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview
              </Button>
              <Button variant="destructive" onClick={() => handleDelete()} disabled={!selectedPipeline || deleting || Boolean(selectedPipeline?.is_system)}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
              </Button>
              {!parsedSpec ? <Badge variant="warning">Invalid spec JSON</Badge> : null}
              {!parsedSchedule ? <Badge variant="warning">Invalid schedule JSON</Badge> : null}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Preview Rows</CardTitle>
            <CardDescription>Dry-run output from the selected pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs text-zinc-300">
              {previewRows.length > 0 ? pretty(previewRows) : '// run preview to inspect transformed rows'}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription>Execution history for the selected pipeline.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">No runs yet.</div>
            ) : (
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={run.status === 'success' ? 'success' : run.status === 'failed' ? 'warning' : 'secondary'}>
                        {run.status}
                      </Badge>
                      <Badge variant="outline">{run.trigger_source}</Badge>
                      <span className="text-xs text-zinc-500">{run.started_at || '-'}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      rows: {run.rows_read} read / {run.rows_written} written
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
