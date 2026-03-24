'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Play, Plus, RefreshCcw, Save, Trash2, Waypoints } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createApiEndpoint,
  deleteApiEndpoint,
  getRealtimeStreamUrl,
  listApiEndpoints,
  runApiEndpointById,
  type ApiEndpointParam,
  type ApiEndpointRecord,
  type ApiEndpointRunResponse,
  updateApiEndpoint,
} from '@/lib/sefi-api';

type ParamRow = {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  defaultValue: string;
  description: string;
};

type LiveEvent = {
  id: string;
  timestamp: string;
  channel: string;
  type: string;
  payload: Record<string, unknown>;
};

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function toParamRows(schema: ApiEndpointParam[]): ParamRow[] {
  return schema.map((entry) => ({
    name: entry.name,
    type: entry.type,
    required: Boolean(entry.required),
    defaultValue: entry.default === undefined || entry.default === null ? '' : String(entry.default),
    description: entry.description || '',
  }));
}

function toApiParamSchema(rows: ParamRow[]): ApiEndpointParam[] {
  return rows
    .map((row) => {
      const normalizedName = row.name.trim();
      if (!normalizedName) return null;

      let parsedDefault: string | number | boolean | null | undefined = undefined;
      if (row.defaultValue.trim() !== '') {
        if (row.type === 'number') {
          const parsed = Number(row.defaultValue);
          parsedDefault = Number.isFinite(parsed) ? parsed : undefined;
        } else if (row.type === 'boolean') {
          const normalized = row.defaultValue.trim().toLowerCase();
          if (['true', '1', 'yes', 'on'].includes(normalized)) parsedDefault = true;
          else if (['false', '0', 'no', 'off'].includes(normalized)) parsedDefault = false;
          else parsedDefault = undefined;
        } else {
          parsedDefault = row.defaultValue;
        }
      }

      const result: ApiEndpointParam = {
        name: normalizedName,
        type: row.type,
        required: row.required,
        description: row.description.trim() || undefined,
      };

      if (parsedDefault !== undefined) {
        result.default = parsedDefault;
      }

      return result;
    })
    .filter((entry): entry is ApiEndpointParam => Boolean(entry));
}

export default function ApiBuilderPage() {
  const [records, setRecords] = useState<ApiEndpointRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [queryTemplateText, setQueryTemplateText] = useState(
    pretty({
      measures: ['contract_logs.count'],
      dimensions: ['contracts.category'],
      limit: '{{limit}}',
      filters: [
        {
          member: 'contracts.category',
          operator: 'equals',
          values: ['{{category}}'],
        },
      ],
    })
  );
  const [paramRows, setParamRows] = useState<ParamRow[]>([
    { name: 'limit', type: 'number', required: false, defaultValue: '50', description: 'Result limit' },
    { name: 'category', type: 'string', required: false, defaultValue: '', description: 'Contract category filter' },
  ]);

  const [runParamsJson, setRunParamsJson] = useState(pretty({ limit: 20 }));
  const [runQueryType, setRunQueryType] = useState<'load' | 'sql'>('load');
  const [runResult, setRunResult] = useState<ApiEndpointRunResponse | null>(null);

  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedRecord = useMemo(() => records.find((entry) => entry.id === selectedId) || null, [records, selectedId]);

  const parsedTemplate = useMemo(() => {
    try {
      return JSON.parse(queryTemplateText) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [queryTemplateText]);

  const parsedRunParams = useMemo(() => {
    try {
      const parsed = JSON.parse(runParamsJson);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }, [runParamsJson]);

  const resetForm = useCallback(() => {
    setSelectedId(null);
    setName('');
    setSlug('');
    setDescription('');
    setEnabled(true);
    setQueryTemplateText(
      pretty({
        measures: ['contract_logs.count'],
        dimensions: ['contracts.category'],
        limit: '{{limit}}',
      })
    );
    setParamRows([{ name: 'limit', type: 'number', required: false, defaultValue: '50', description: 'Result limit' }]);
  }, []);

  const loadEndpoints = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await listApiEndpoints();
      setRecords(payload.records);
      if (!selectedId && payload.records.length > 0) {
        setSelectedId(payload.records[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load API endpoints');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadEndpoints();
  }, [loadEndpoints]);

  useEffect(() => {
    if (!selectedRecord) return;
    setName(selectedRecord.name);
    setSlug(selectedRecord.slug);
    setDescription(selectedRecord.description || '');
    setEnabled(selectedRecord.enabled);
    setQueryTemplateText(pretty(selectedRecord.query_template));
    setParamRows(toParamRows(selectedRecord.params_schema));
  }, [selectedRecord]);

  useEffect(() => {
    const stream = new EventSource(getRealtimeStreamUrl(['index', 'api', 'activity']), { withCredentials: true });
    stream.onopen = () => {
      setNotice((current) => (current === 'Realtime stream interrupted. Retrying...' ? 'Realtime stream connected.' : current));
    };
    stream.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LiveEvent;
        setLiveEvents((current) => [parsed, ...current].slice(0, 120));
      } catch {
        // ignore malformed events
      }
    };
    stream.onerror = () => {
      setNotice((current) => current || 'Realtime stream interrupted. Retrying...');
    };

    return () => {
      stream.close();
    };
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!slug.trim()) {
      setError('Slug is required');
      return;
    }
    if (!parsedTemplate) {
      setError('Query template must be valid JSON');
      return;
    }

    const paramsSchema = toApiParamSchema(paramRows);

    try {
      setSaving(true);
      setError(null);
      setNotice(null);

      if (selectedRecord) {
        const updated = await updateApiEndpoint(selectedRecord.id, {
          name,
          slug,
          description,
          enabled,
          query_template: parsedTemplate,
          params_schema: paramsSchema,
        });
        setRecords((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
        setNotice(`Updated endpoint ${updated.slug}`);
      } else {
        const created = await createApiEndpoint({
          name,
          slug,
          description,
          enabled,
          query_template: parsedTemplate,
          params_schema: paramsSchema,
        });
        setRecords((current) => [created, ...current]);
        setSelectedId(created.id);
        setNotice(`Created endpoint ${created.slug}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save endpoint');
    } finally {
      setSaving(false);
    }
  }, [description, enabled, name, paramRows, parsedTemplate, selectedRecord, slug]);

  const handleDelete = useCallback(async () => {
    if (!selectedRecord) return;
    const confirmed = window.confirm(`Delete endpoint \"${selectedRecord.slug}\"?`);
    if (!confirmed) return;

    try {
      setDeleting(true);
      setError(null);
      setNotice(null);
      await deleteApiEndpoint(selectedRecord.id);
      setRecords((current) => current.filter((entry) => entry.id !== selectedRecord.id));
      setRunResult(null);
      resetForm();
      setNotice(`Deleted endpoint ${selectedRecord.slug}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete endpoint');
    } finally {
      setDeleting(false);
    }
  }, [resetForm, selectedRecord]);

  const handleRun = useCallback(async () => {
    if (!selectedRecord) return;
    if (!parsedRunParams) {
      setError('Run params must be valid JSON object');
      return;
    }

    try {
      setRunning(true);
      setError(null);
      setNotice(null);
      const result = await runApiEndpointById(selectedRecord.id, {
        params: parsedRunParams,
        queryType: runQueryType,
      });
      setRunResult(result);
      setNotice(`Endpoint ${selectedRecord.slug} executed successfully.`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to execute endpoint');
    } finally {
      setRunning(false);
    }
  }, [parsedRunParams, runQueryType, selectedRecord]);

  const curlSnippet = useMemo(() => {
    if (!selectedRecord) return '// select or create an endpoint first';
    return [
      `curl -X POST \\\n  -H \"Content-Type: application/json\" \\\n  --data '${runParamsJson || '{}'}' \\\n  http://localhost:3210/api/v1/endpoints/${selectedRecord.slug}`,
    ].join('\n');
  }, [runParamsJson, selectedRecord]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Modeling / API</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Custom API Builder</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Create reusable, authenticated API endpoints for parameterized Cube queries and monitor live execution/index events.
        </p>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => loadEndpoints()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="secondary" onClick={() => resetForm()}>
            <Plus className="h-4 w-4" /> New Endpoint
          </Button>
          {loading ? <Badge variant="secondary">Loading...</Badge> : <Badge variant="outline">{records.length} endpoints</Badge>}
          {notice ? <Badge variant="success">{notice}</Badge> : null}
          {error ? <Badge variant="warning">{error}</Badge> : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>Saved endpoint definitions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {records.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">No endpoints yet.</div>
            ) : (
              <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {records.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setSelectedId(record.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedId === record.id
                        ? 'border-white/25 bg-white/10'
                        : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30'
                    }`}
                  >
                    <p className="font-mono text-xs text-zinc-100">{record.slug}</p>
                    <p className="mt-1 text-xs text-zinc-400">{record.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant={record.enabled ? 'success' : 'warning'}>{record.enabled ? 'enabled' : 'disabled'}</Badge>
                      {record.last_run_status ? <Badge variant="outline">last run: {record.last_run_status}</Badge> : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Definition Editor</CardTitle>
            <CardDescription>Typed params + query template. Save to publish endpoint behavior.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Endpoint name"
                className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
              />
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="endpoint-slug"
                className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 font-mono text-sm text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
              className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
            />

            <label className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">
              Enabled
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            </label>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Parameter Schema</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setParamRows((current) => [
                      ...current,
                      { name: '', type: 'string', required: false, defaultValue: '', description: '' },
                    ])
                  }
                >
                  <Plus className="h-4 w-4" /> Param
                </Button>
              </div>
              <div className="space-y-2">
                {paramRows.map((row, index) => (
                  <div key={`param-${index}`} className="grid gap-2 md:grid-cols-5">
                    <input
                      value={row.name}
                      onChange={(event) =>
                        setParamRows((current) =>
                          current.map((entry, idx) => (idx === index ? { ...entry, name: event.target.value } : entry))
                        )
                      }
                      placeholder="name"
                      className="h-9 rounded-md border border-white/15 bg-black/35 px-2 text-xs text-zinc-200"
                    />
                    <select
                      value={row.type}
                      onChange={(event) =>
                        setParamRows((current) =>
                          current.map((entry, idx) =>
                            idx === index ? { ...entry, type: event.target.value as ParamRow['type'] } : entry
                          )
                        )
                      }
                      className="h-9 rounded-md border border-white/15 bg-black/35 px-2 text-xs text-zinc-200"
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                    <input
                      value={row.defaultValue}
                      onChange={(event) =>
                        setParamRows((current) =>
                          current.map((entry, idx) => (idx === index ? { ...entry, defaultValue: event.target.value } : entry))
                        )
                      }
                      placeholder="default"
                      className="h-9 rounded-md border border-white/15 bg-black/35 px-2 text-xs text-zinc-200"
                    />
                    <input
                      value={row.description}
                      onChange={(event) =>
                        setParamRows((current) =>
                          current.map((entry, idx) => (idx === index ? { ...entry, description: event.target.value } : entry))
                        )
                      }
                      placeholder="description"
                      className="h-9 rounded-md border border-white/15 bg-black/35 px-2 text-xs text-zinc-200"
                    />
                    <label className="flex items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2 text-xs text-zinc-300">
                      required
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(event) =>
                          setParamRows((current) =>
                            current.map((entry, idx) => (idx === index ? { ...entry, required: event.target.checked } : entry))
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Query Template JSON</p>
              <textarea
                value={queryTemplateText}
                onChange={(event) => setQueryTemplateText(event.target.value)}
                rows={12}
                className="w-full rounded-md border border-white/15 bg-black/35 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleSave()} disabled={saving || !parsedTemplate}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Endpoint
              </Button>
              <Button variant="destructive" onClick={() => handleDelete()} disabled={!selectedRecord || deleting}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
              </Button>
              {!parsedTemplate ? <Badge variant="warning">Invalid query template JSON</Badge> : null}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Run Console</CardTitle>
            <CardDescription>Test endpoint execution using typed params.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <select
                value={runQueryType}
                onChange={(event) => setRunQueryType(event.target.value as 'load' | 'sql')}
                className="h-10 rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200"
              >
                <option value="load">load</option>
                <option value="sql">sql</option>
              </select>
              <Button onClick={() => handleRun()} disabled={!selectedRecord || running || !parsedRunParams}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run Endpoint
              </Button>
              {!parsedRunParams ? <Badge variant="warning">Invalid params JSON</Badge> : null}
            </div>

            <textarea
              value={runParamsJson}
              onChange={(event) => setRunParamsJson(event.target.value)}
              rows={8}
              className="w-full rounded-md border border-white/15 bg-black/35 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
            />

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">cURL</p>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">{curlSnippet}</pre>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Run Result</p>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">
                {runResult ? pretty(runResult) : '// run endpoint to inspect payload'}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Live Feed</CardTitle>
            <CardDescription>SSE-only stream across index/api/activity channels.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-400">
              <Waypoints className="h-4 w-4" />
              <span>{liveEvents.length} recent events</span>
            </div>

            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {liveEvents.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">Waiting for events...</div>
              ) : (
                liveEvents.map((event) => (
                  <div key={`${event.id}-${event.timestamp}`} className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline">{event.channel}</Badge>
                      <Badge variant="secondary">{event.type}</Badge>
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-500">{event.timestamp}</p>
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-400">
                      {pretty(event.payload)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
