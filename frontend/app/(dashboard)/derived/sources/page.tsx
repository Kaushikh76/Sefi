'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, Loader2, Plus, RefreshCcw, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createDerivedSource,
  deleteDerivedSource,
  listDerivedSourceRuns,
  listDerivedSources,
  testDerivedSource,
  updateDerivedSource,
  type DerivedAuthMode,
  type DerivedExternalSource,
  type DerivedExternalSourceRun,
  type DerivedSourceTestResponse,
} from '@/lib/sefi-api';

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function navClass(active: boolean) {
  return active
    ? 'rounded-md border border-white/30 bg-white/10 px-3 py-1.5 text-xs text-zinc-100'
    : 'rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-400 hover:border-white/20 hover:text-zinc-100';
}

function defaultRequest() {
  return {
    path: '/market',
    method: 'GET',
    params: {},
    headers: {},
  };
}

function defaultNormalization() {
  return {
    records_path: 'reserves',
    key_field: 'evm_address',
    fields: {
      evm_address: 'evm_address',
      hts_address: 'hts_address',
      symbol: 'symbol',
      price_usd_display: 'price_usd_display',
      price_usd_wad: 'price_usd_wad',
    },
  };
}

export default function DerivedSourcesPage() {
  const [sources, setSources] = useState<DerivedExternalSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<DerivedExternalSourceRun[]>([]);
  const [testResult, setTestResult] = useState<DerivedSourceTestResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [baseUrl, setBaseUrl] = useState('https://data.bonzo.finance/');
  const [authMode, setAuthMode] = useState<DerivedAuthMode>('none');
  const [authHeaderName, setAuthHeaderName] = useState('x-api-key');
  const [authToken, setAuthToken] = useState('');
  const [requestText, setRequestText] = useState(pretty(defaultRequest()));
  const [normalizationText, setNormalizationText] = useState(pretty(defaultNormalization()));

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedId) || null,
    [sources, selectedId]
  );

  const parsedRequest = useMemo(() => {
    try {
      const parsed = JSON.parse(requestText);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }, [requestText]);

  const parsedNormalization = useMemo(() => {
    try {
      const parsed = JSON.parse(normalizationText);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }, [normalizationText]);

  const resetForm = useCallback(() => {
    setSelectedId(null);
    setName('');
    setSlug('');
    setDescription('');
    setEnabled(true);
    setBaseUrl('https://data.bonzo.finance/');
    setAuthMode('none');
    setAuthHeaderName('x-api-key');
    setAuthToken('');
    setRequestText(pretty(defaultRequest()));
    setNormalizationText(pretty(defaultNormalization()));
    setRuns([]);
    setTestResult(null);
  }, []);

  const loadSources = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await listDerivedSources();
      setSources(payload.records);
      if (!selectedId && payload.records.length > 0) {
        setSelectedId(payload.records[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadRuns = useCallback(async (sourceId: string) => {
    try {
      const payload = await listDerivedSourceRuns(sourceId, 30);
      setRuns(payload.records);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (!selectedSource) return;
    setName(selectedSource.name);
    setSlug(selectedSource.slug);
    setDescription(selectedSource.description || '');
    setEnabled(selectedSource.enabled);
    setBaseUrl(selectedSource.base_url);
    setAuthMode(selectedSource.auth_mode);

    const authConfig = selectedSource.auth_config || {};
    setAuthHeaderName(String(authConfig.header_name || 'x-api-key'));
    if (selectedSource.auth_mode === 'bearer') {
      setAuthToken(String(authConfig.bearer_token || authConfig.token || ''));
    } else if (selectedSource.auth_mode === 'api_key') {
      setAuthToken(String(authConfig.api_key || authConfig.token || ''));
    } else {
      setAuthToken('');
    }

    setRequestText(pretty(selectedSource.request || {}));
    setNormalizationText(pretty(selectedSource.normalization || {}));
    setTestResult(null);
    loadRuns(selectedSource.id);
  }, [loadRuns, selectedSource]);

  const buildAuthConfig = useCallback(() => {
    if (authMode === 'api_key') {
      return {
        header_name: authHeaderName || 'x-api-key',
        api_key: authToken,
      };
    }
    if (authMode === 'bearer') {
      return {
        bearer_token: authToken,
      };
    }
    return {};
  }, [authHeaderName, authMode, authToken]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!baseUrl.trim()) {
      setError('Base URL is required');
      return;
    }
    if (!parsedRequest) {
      setError('Request JSON is invalid');
      return;
    }
    if (!parsedNormalization) {
      setError('Normalization JSON is invalid');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setNotice(null);

      if (selectedSource) {
        const updated = await updateDerivedSource(selectedSource.id, {
          name,
          slug,
          description,
          enabled,
          base_url: baseUrl,
          auth_mode: authMode,
          auth_config: buildAuthConfig(),
          request: parsedRequest,
          normalization: parsedNormalization,
        });
        setSources((current) => current.map((source) => (source.id === updated.id ? updated : source)));
        setNotice(`Updated source ${updated.slug}`);
      } else {
        const created = await createDerivedSource({
          name,
          slug,
          description,
          enabled,
          base_url: baseUrl,
          auth_mode: authMode,
          auth_config: buildAuthConfig(),
          request: parsedRequest,
          normalization: parsedNormalization,
        });
        setSources((current) => [created, ...current]);
        setSelectedId(created.id);
        setNotice(`Created source ${created.slug}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save source');
    } finally {
      setSaving(false);
    }
  }, [
    authMode,
    baseUrl,
    buildAuthConfig,
    description,
    enabled,
    name,
    parsedNormalization,
    parsedRequest,
    selectedSource,
    slug,
  ]);

  const handleDelete = useCallback(async () => {
    if (!selectedSource) return;
    if (selectedSource.is_system) {
      setError('System sources cannot be deleted');
      return;
    }

    const confirmed = window.confirm(`Delete source "${selectedSource.slug}"?`);
    if (!confirmed) return;

    try {
      setDeleting(true);
      setError(null);
      await deleteDerivedSource(selectedSource.id);
      setSources((current) => current.filter((source) => source.id !== selectedSource.id));
      resetForm();
      setNotice(`Deleted source ${selectedSource.slug}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete source');
    } finally {
      setDeleting(false);
    }
  }, [resetForm, selectedSource]);

  const handleTest = useCallback(async () => {
    if (!selectedSource) return;
    try {
      setTesting(true);
      setError(null);
      setNotice(null);
      const result = await testDerivedSource(selectedSource.id, {
        persist: true,
        max_records: 200,
      });
      setTestResult(result);
      setNotice(`Fetched ${result.records_fetched} records`);
      await loadRuns(selectedSource.id);
      await loadSources();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Failed to run source test');
    } finally {
      setTesting(false);
    }
  }, [loadRuns, loadSources, selectedSource]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Derived Tables</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">External Sources</h1>
        <p className="mt-2 max-w-4xl text-sm text-zinc-400">
          Register API sources for enrichment (Bonzo preset included) and cache normalized records.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/derived/pipelines" className={navClass(false)}>Pipelines</Link>
          <Link href="/derived/sources" className={navClass(true)}>Sources</Link>
          <Link href="/derived/runs" className={navClass(false)}>Runs</Link>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => loadSources()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="secondary" onClick={() => resetForm()}>
            <Plus className="h-4 w-4" /> New Source
          </Button>
          {loading ? <Badge variant="secondary">Loading...</Badge> : <Badge variant="outline">{sources.length} sources</Badge>}
          {notice ? <Badge variant="success">{notice}</Badge> : null}
          {error ? <Badge variant="warning">{error}</Badge> : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>Use custom APIs or built-in Bonzo market feed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sources.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">No sources found.</div>
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedId(source.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedId === source.id
                        ? 'border-white/25 bg-white/10'
                        : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30'
                    }`}
                  >
                    <p className="font-mono text-xs text-zinc-100">{source.slug}</p>
                    <p className="mt-1 text-xs text-zinc-400">{source.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant={source.enabled ? 'success' : 'warning'}>{source.enabled ? 'enabled' : 'disabled'}</Badge>
                      {source.is_system ? <Badge variant="outline">system</Badge> : null}
                      {source.last_success_at ? <Badge variant="secondary">ready</Badge> : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Source Editor</CardTitle>
            <CardDescription>Configure base URL, auth mode, endpoint request, and normalization mapping.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Source name"
                className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
              />
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="source-slug"
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
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/"
              className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 font-mono text-sm text-zinc-200 outline-none focus:border-white/30"
            />

            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={authMode}
                onChange={(event) => setAuthMode(event.target.value as DerivedAuthMode)}
                className="h-10 rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200"
              >
                <option value="none">none</option>
                <option value="api_key">api_key</option>
                <option value="bearer">bearer</option>
              </select>
              <label className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                Enabled
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              </label>
            </div>

            {authMode === 'api_key' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  value={authHeaderName}
                  onChange={(event) => setAuthHeaderName(event.target.value)}
                  placeholder="Header name"
                  className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
                />
                <input
                  value={authToken}
                  onChange={(event) => setAuthToken(event.target.value)}
                  placeholder="API key"
                  className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
                />
              </div>
            ) : null}

            {authMode === 'bearer' ? (
              <input
                value={authToken}
                onChange={(event) => setAuthToken(event.target.value)}
                placeholder="Bearer token"
                className="h-10 w-full rounded-md border border-white/15 bg-black/35 px-3 text-sm text-zinc-200 outline-none focus:border-white/30"
              />
            ) : null}

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Request JSON</p>
              <textarea
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
                rows={8}
                className="w-full rounded-md border border-white/15 bg-black/35 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Normalization JSON</p>
              <textarea
                value={normalizationText}
                onChange={(event) => setNormalizationText(event.target.value)}
                rows={8}
                className="w-full rounded-md border border-white/15 bg-black/35 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-white/30"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleSave()} disabled={saving || !parsedRequest || !parsedNormalization}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </Button>
              <Button onClick={() => handleTest()} disabled={!selectedSource || testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Test
              </Button>
              <Button variant="destructive" onClick={() => handleDelete()} disabled={!selectedSource || deleting || Boolean(selectedSource?.is_system)}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
              </Button>
              {!parsedRequest ? <Badge variant="warning">Invalid request JSON</Badge> : null}
              {!parsedNormalization ? <Badge variant="warning">Invalid normalization JSON</Badge> : null}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Latest Test Result</CardTitle>
            <CardDescription>Normalized sample records from the last source test.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs text-zinc-300">
              {testResult ? pretty(testResult.sample_records) : '// run test to view sample normalized records'}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription>Execution history for the selected source.</CardDescription>
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
                      <Badge variant="outline">{run.trigger_source || 'manual'}</Badge>
                      <span className="text-xs text-zinc-500">{run.started_at || '-'}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">records fetched: {run.records_fetched}</p>
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
