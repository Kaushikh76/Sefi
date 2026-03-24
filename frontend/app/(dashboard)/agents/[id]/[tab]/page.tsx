'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ExternalLink, Loader2, PauseCircle, PlayCircle, Save, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  applyManagedAgentBrainstorm,
  deleteManagedAgent,
  getAgentTemplates,
  getManagedAgent,
  getManagedAgentActivity,
  getManagedAgentRuns,
  runManagedAgentPublishTest,
  startManagedAgent,
  stopManagedAgent,
  updateManagedAgent,
  type ManagedAgentRecord,
} from '@/lib/sefi-api';

const TABS = new Set(['brainstorm', 'semantic', 'tools', 'automations', 'publish', 'activity', 'settings']);
const HEDERA_TOOLS = ['sefi.semantic.context', 'sefi.semantic.query', 'sefi.semantic.summarize', 'hedera.hcs.create', 'hedera.hcs.publish'];
const ELIZA_TOOLS = ['@elizaos/plugin-bootstrap', '@elizaos/plugin-hedera', 'plugin-sefi-semantic', '@elizaos/plugin-twitter'];

function parseCommaList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTopicExplorerUrl(network: string, topicId: string) {
  if (!topicId) return '';
  const normalizedNetwork = String(network || 'mainnet').toLowerCase();
  const encoded = encodeURIComponent(topicId);
  if (normalizedNetwork === 'testnet') return `https://hashscan.io/testnet/topic/${encoded}`;
  if (normalizedNetwork === 'previewnet') return `https://hashscan.io/previewnet/topic/${encoded}`;
  return `https://hashscan.io/mainnet/topic/${encoded}`;
}

export default function AgentTabPage() {
  const params = useParams<{ id: string; tab: string }>();
  const router = useRouter();
  const agentId = decodeURIComponent(params.id || '');
  const tab = String(params.tab || 'brainstorm').toLowerCase();

  const [agent, setAgent] = useState<ManagedAgentRecord | null>(null);
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [templates, setTemplates] = useState<Array<{ key: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [draftName, setDraftName] = useState('');
  const [draftNetwork, setDraftNetwork] = useState('testnet');
  const [draftModelProvider, setDraftModelProvider] = useState('openai');
  const [draftModelName, setDraftModelName] = useState('gpt-5-mini');
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  const [draftEnvRefs, setDraftEnvRefs] = useState('key=ENV_VAR_NAME');

  const [semanticCubes, setSemanticCubes] = useState('');
  const [semanticMembers, setSemanticMembers] = useState('');
  const [semanticTimeWindow, setSemanticTimeWindow] = useState('7d');
  const [semanticMaxRows, setSemanticMaxRows] = useState(200);

  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState(60);
  const [scheduleCron, setScheduleCron] = useState('');
  const [scheduleTimezone, setScheduleTimezone] = useState('UTC');
  const [scheduleAction, setScheduleAction] = useState('publish_test');
  const [scheduleQuestion, setScheduleQuestion] = useState('Generate a semantic summary for recent protocol activity.');
  const [scheduleSummary, setScheduleSummary] = useState('Scheduled protocol summary update.');
  const [scheduleVoice, setScheduleVoice] = useState('Keep this concise and operator-friendly.');

  const [brainstormTemplate, setBrainstormTemplate] = useState('market_pulse');
  const [brainstormIdea, setBrainstormIdea] = useState('');
  const [brainstormAudience, setBrainstormAudience] = useState('');
  const [brainstormTone, setBrainstormTone] = useState('');
  const [brainstormMetrics, setBrainstormMetrics] = useState('');
  const [brainstormSamples, setBrainstormSamples] = useState('');

  const [hcsEnabled, setHcsEnabled] = useState(true);
  const [hcsTopicId, setHcsTopicId] = useState('');
  const [twitterEnabled, setTwitterEnabled] = useState(false);
  const [publishQuestion, setPublishQuestion] = useState('Generate a semantic summary for recent indexing activity.');
  const [publishSummary, setPublishSummary] = useState('Automated semantic summary from SeFi agent workspace.');
  const [publishVoice, setPublishVoice] = useState('Keep this concise and market-readable.');

  const availableTools = useMemo(() => {
    if (!agent) return [];
    return agent.type === 'hedera' ? HEDERA_TOOLS : ELIZA_TOOLS;
  }, [agent]);

  const hydrateDrafts = useCallback((value: ManagedAgentRecord) => {
    setDraftName(value.name);
    setDraftNetwork(value.network);
    setDraftModelProvider(value.model_provider);
    setDraftModelName(value.model_name);
    setDraftSystemPrompt(value.system_prompt || '');
    setDraftEnvRefs((value.env_refs || []).map((item) => `${item.key}=${item.env_var_name}`).join(', '));

    const scope = (value.semantic_scope || {}) as Record<string, unknown>;
    setSemanticCubes((Array.isArray(scope.allowed_cubes) ? scope.allowed_cubes : []).join(', '));
    setSemanticMembers((Array.isArray(scope.allowed_members) ? scope.allowed_members : []).join(', '));
    setSemanticTimeWindow(String(scope.time_window || '7d'));
    setSemanticMaxRows(Number(scope.max_rows || 200));

    setSelectedTools((value.tool_allowlist || []).slice());
    const schedule = (value.schedule || {}) as Record<string, unknown>;
    setScheduleEnabled(Boolean(schedule.enabled));
    const intervalMinutes = Number(schedule.interval_minutes || schedule.intervalMinutes || 60);
    setScheduleIntervalMinutes(Number.isFinite(intervalMinutes) ? Math.max(1, Math.min(1440, Math.trunc(intervalMinutes))) : 60);
    setScheduleCron(String(schedule.cron || ''));
    setScheduleTimezone(String(schedule.timezone || 'UTC'));
    setScheduleAction(String(schedule.action || 'publish_test'));
    setScheduleQuestion(String(schedule.question || 'Generate a semantic summary for recent protocol activity.'));
    setScheduleSummary(String(schedule.summary || 'Scheduled protocol summary update.'));
    setScheduleVoice(String(schedule.voice_text || 'Keep this concise and operator-friendly.'));

    const publishTargets = (value.publish_targets || {}) as Record<string, unknown>;
    const hcs = (publishTargets.hcs || {}) as Record<string, unknown>;
    const twitter = (publishTargets.twitter || {}) as Record<string, unknown>;
    setHcsEnabled(Boolean(hcs.enabled ?? true));
    setHcsTopicId(String(hcs.topic_id || ''));
    setTwitterEnabled(Boolean(twitter.enabled));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const [agentPayload, runsPayload, eventsPayload, templatePayload] = await Promise.all([
        getManagedAgent(agentId),
        getManagedAgentRuns(agentId, 50),
        getManagedAgentActivity(agentId, 100),
        getAgentTemplates(),
      ]);
      setAgent(agentPayload);
      setRuns(runsPayload.records);
      setEvents(eventsPayload.records);
      setTemplates(templatePayload.templates.map((item) => ({ key: item.key, label: item.label })));
      hydrateDrafts(agentPayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load agent workspace');
    } finally {
      setLoading(false);
    }
  }, [agentId, hydrateDrafts]);

  useEffect(() => {
    if (!TABS.has(tab)) {
      router.replace(`/agents/${agentId}/brainstorm`);
      return;
    }
    refresh();
  }, [agentId, refresh, router, tab]);

  const patchAndRefresh = useCallback(async (patch: Record<string, unknown>, successMessage: string) => {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const updated = await updateManagedAgent(agentId, patch);
      setAgent(updated);
      hydrateDrafts(updated);
      setNotice(successMessage);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save agent changes');
    } finally {
      setBusy(false);
    }
  }, [agentId, hydrateDrafts]);

  const handleStart = useCallback(async () => {
    try {
      setBusy(true);
      setError(null);
      const started = await startManagedAgent(agentId);
      setAgent(started);
      setNotice('Agent started.');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Failed to start agent');
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  const handleStop = useCallback(async () => {
    try {
      setBusy(true);
      setError(null);
      const stopped = await stopManagedAgent(agentId);
      setAgent(stopped);
      setNotice('Agent stopped.');
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Failed to stop agent');
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  const handleDelete = useCallback(async () => {
    const confirmed = window.confirm('Delete this agent? This action cannot be undone.');
    if (!confirmed) return;
    try {
      setBusy(true);
      setError(null);
      await deleteManagedAgent(agentId);
      router.push('/agents');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete agent');
    } finally {
      setBusy(false);
    }
  }, [agentId, router]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading agent workspace...
      </div>
    );
  }

  if (!agent) {
    return <p className="text-sm text-zinc-400">Agent not found.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-black/30 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agent Workspace</p>
        <h1 className="mt-1 text-2xl font-semibold text-zinc-100">{agent.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{agent.type}</Badge>
          <Badge variant="outline">{agent.network}</Badge>
          <Badge variant={agent.runtime_status === 'running' ? 'success' : agent.runtime_status === 'degraded' ? 'warning' : 'outline'}>
            {agent.runtime_status}
          </Badge>
          {error ? <Badge variant="warning">{error}</Badge> : null}
          {notice ? <Badge variant="success">{notice}</Badge> : null}
        </div>
      </section>

      {tab === 'brainstorm' ? (
        <Card>
          <CardHeader>
            <CardTitle>Brainstorm</CardTitle>
            <CardDescription>Define idea, audience, tone, required metrics, and sample drafts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={brainstormTemplate}
              onChange={(event) => setBrainstormTemplate(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            >
              {templates.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
            <input value={brainstormIdea} onChange={(event) => setBrainstormIdea(event.target.value)} placeholder="Idea" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <input value={brainstormAudience} onChange={(event) => setBrainstormAudience(event.target.value)} placeholder="Audience" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <input value={brainstormTone} onChange={(event) => setBrainstormTone(event.target.value)} placeholder="Tone" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <input value={brainstormMetrics} onChange={(event) => setBrainstormMetrics(event.target.value)} placeholder="Required metrics (comma separated)" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <textarea value={brainstormSamples} onChange={(event) => setBrainstormSamples(event.target.value)} rows={3} placeholder="Sample drafts (comma separated)" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <Button
              onClick={async () => {
                try {
                  setBusy(true);
                  setError(null);
                  const result = await applyManagedAgentBrainstorm(agentId, {
                    template_key: brainstormTemplate,
                    idea: brainstormIdea,
                    audience: brainstormAudience,
                    tone: brainstormTone,
                    required_metrics: parseCommaList(brainstormMetrics),
                    sample_drafts: parseCommaList(brainstormSamples),
                  });
                  setAgent(result.agent);
                  hydrateDrafts(result.agent);
                  setNotice(`Applied brainstorm template: ${result.template.label}`);
                } catch (brainstormError) {
                  setError(brainstormError instanceof Error ? brainstormError.message : 'Failed to apply brainstorm');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Save Brainstorm
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'semantic' ? (
        <Card>
          <CardHeader>
            <CardTitle>Semantic Scope</CardTitle>
            <CardDescription>Control allowed cubes, members, time window, and max rows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input value={semanticCubes} onChange={(event) => setSemanticCubes(event.target.value)} placeholder="Allowed cubes (comma separated)" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <input value={semanticMembers} onChange={(event) => setSemanticMembers(event.target.value)} placeholder="Allowed members (comma separated)" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <div className="grid grid-cols-2 gap-2">
              <input value={semanticTimeWindow} onChange={(event) => setSemanticTimeWindow(event.target.value)} placeholder="7d" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
              <input type="number" value={semanticMaxRows} min={1} max={2000} onChange={(event) => setSemanticMaxRows(Number(event.target.value || 200))} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            </div>
            <Button
              onClick={() => patchAndRefresh({
                semantic_scope: {
                  allowed_cubes: parseCommaList(semanticCubes),
                  allowed_members: parseCommaList(semanticMembers),
                  time_window: semanticTimeWindow || '7d',
                  max_rows: Math.max(1, Math.min(Number(semanticMaxRows) || 200, 2000)),
                },
              }, 'Semantic scope updated.')}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Semantic Scope
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'tools' ? (
        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>Select allowed tools/plugins for this agent runtime.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {availableTools.map((tool) => (
              <label key={tool} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
                <span>{tool}</span>
                <input
                  type="checkbox"
                  checked={selectedTools.includes(tool)}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setSelectedTools((current) => Array.from(new Set([...current, tool])));
                    } else {
                      setSelectedTools((current) => current.filter((item) => item !== tool));
                    }
                  }}
                />
              </label>
            ))}
            <Button onClick={() => patchAndRefresh({ tool_allowlist: selectedTools }, 'Tool allowlist updated.')} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Tools
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'automations' ? (
        <Card>
          <CardHeader>
            <CardTitle>Automations</CardTitle>
            <CardDescription>Define cadence and choose what this automation should execute.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
              <span>Schedule Enabled</span>
              <input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={scheduleIntervalMinutes}
                min={1}
                max={1440}
                onChange={(event) => setScheduleIntervalMinutes(Number(event.target.value || 60))}
                placeholder="Interval minutes"
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
              />
              <input
                value={scheduleTimezone}
                onChange={(event) => setScheduleTimezone(event.target.value)}
                placeholder="UTC"
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
              />
            </div>

            <select
              value={scheduleAction}
              onChange={(event) => setScheduleAction(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="publish_test">Semantic Publish Run</option>
              <option value="bonzo_clmm_guard">Bonzo CLMM Volatility Guard</option>
            </select>
            <textarea
              value={scheduleQuestion}
              onChange={(event) => setScheduleQuestion(event.target.value)}
              rows={2}
              placeholder="Automation question"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />
            <textarea
              value={scheduleSummary}
              onChange={(event) => setScheduleSummary(event.target.value)}
              rows={2}
              placeholder="Automation summary template"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />
            <textarea
              value={scheduleVoice}
              onChange={(event) => setScheduleVoice(event.target.value)}
              rows={2}
              placeholder="Voice style"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />
            <Button
              onClick={() => {
                const intervalMinutes = Math.max(1, Math.min(1440, Math.trunc(Number(scheduleIntervalMinutes) || 60)));
                const cron = `*/${intervalMinutes} * * * *`;
                setScheduleCron(cron);
                patchAndRefresh({
                  schedule: {
                    enabled: scheduleEnabled,
                    cadence: 'interval',
                    interval_minutes: intervalMinutes,
                    cron,
                    timezone: scheduleTimezone || 'UTC',
                    action: scheduleAction || 'publish_test',
                    question: scheduleQuestion,
                    summary: scheduleSummary,
                    voice_text: scheduleVoice,
                  },
                }, 'Automation settings updated.');
              }}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Automations
            </Button>
            <p className="text-xs text-zinc-500">
              Current cron preview: <span className="font-mono text-zinc-300">{scheduleCron || `*/${Math.max(1, Math.min(1440, Math.trunc(Number(scheduleIntervalMinutes) || 60)))} * * * *`}</span>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'publish' ? (
        <Card>
          <CardHeader>
            <CardTitle>Publish</CardTitle>
            <CardDescription>Configure HCS and Twitter publishing, then run publish tests.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
              <span>HCS Enabled</span>
              <input type="checkbox" checked={hcsEnabled} onChange={(event) => setHcsEnabled(event.target.checked)} />
            </label>
            <input value={hcsTopicId} onChange={(event) => setHcsTopicId(event.target.value)} placeholder="Optional HCS topic ID (0.0.x)" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
              <span>Twitter Enabled (Eliza only)</span>
              <input type="checkbox" checked={twitterEnabled} onChange={(event) => setTwitterEnabled(event.target.checked)} />
            </label>
            <textarea value={publishQuestion} onChange={(event) => setPublishQuestion(event.target.value)} rows={2} placeholder="Semantic question" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <textarea value={publishSummary} onChange={(event) => setPublishSummary(event.target.value)} rows={2} placeholder="Summary text" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <textarea value={publishVoice} onChange={(event) => setPublishVoice(event.target.value)} rows={2} placeholder="Voice style text" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => patchAndRefresh({
                  publish_targets: {
                    hcs: {
                      enabled: hcsEnabled,
                      topic_id: hcsTopicId || null,
                      create_if_missing: true,
                    },
                    twitter: {
                      enabled: twitterEnabled,
                    },
                  },
                }, 'Publish settings updated.')}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Publish Settings
              </Button>
              <Button
                onClick={async () => {
                  try {
                    setBusy(true);
                    setError(null);
                    const result = await runManagedAgentPublishTest(agentId, {
                      question: publishQuestion,
                      summary: publishSummary,
                      voice_text: publishVoice,
                    });
                    setNotice(result.summary);
                    setAgent(result.agent);
                    await refresh();
                  } catch (publishError) {
                    setError(publishError instanceof Error ? publishError.message : 'Publish test failed');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Run Publish Test
              </Button>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Registered Topics</p>
              <div className="mt-2 space-y-2">
                {(agent.topic_registrations || []).length === 0 ? (
                  <p className="text-xs text-zinc-500">No topic registrations yet. Run a publish test to create/register one.</p>
                ) : (
                  agent.topic_registrations.map((topic) => {
                    const explorerUrl = buildTopicExplorerUrl(topic.network, topic.topic_id);
                    return (
                      <div key={`${topic.network}:${topic.topic_id}`} className="rounded border border-white/10 bg-black/30 p-2 text-xs">
                        <p className="text-zinc-100">{topic.label || topic.topic_id}</p>
                        <p className="mt-1 text-zinc-500">{topic.network} / {topic.topic_id}</p>
                        {explorerUrl ? (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-zinc-300 hover:text-zinc-100"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open in Hedera Explorer
                          </a>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'activity' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Runs</CardTitle>
              <CardDescription>Execution and publish telemetry for this agent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {runs.length === 0 ? (
                <p className="text-sm text-zinc-500">No runs yet.</p>
              ) : (
                runs.map((run) => (
                  <div key={String(run.id)} className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
                    <p className="text-zinc-100">{String(run.summary || '-')}</p>
                    <p className="mt-1 text-zinc-500">{String(run.status || '-')} / {String(run.mode || '-')}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent Events</CardTitle>
              <CardDescription>Normalized runtime and publish events.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {events.length === 0 ? (
                <p className="text-sm text-zinc-500">No events yet.</p>
              ) : (
                events.map((event) => (
                  <div key={String(event.id)} className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
                    <p className="text-zinc-100">{String(event.message || '-')}</p>
                    <p className="mt-1 text-zinc-500">{String(event.event_type || '-')} / {String(event.level || '-')}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Runtime controls, model config, prompts, env references, and destructive actions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Agent name" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <div className="grid grid-cols-2 gap-2">
              <input value={draftNetwork} onChange={(event) => setDraftNetwork(event.target.value)} placeholder="network" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
              <input value={draftModelProvider} onChange={(event) => setDraftModelProvider(event.target.value)} placeholder="model provider" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            </div>
            <input value={draftModelName} onChange={(event) => setDraftModelName(event.target.value)} placeholder="model name" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <textarea value={draftSystemPrompt} onChange={(event) => setDraftSystemPrompt(event.target.value)} rows={4} placeholder="system prompt" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <textarea value={draftEnvRefs} onChange={(event) => setDraftEnvRefs(event.target.value)} rows={3} placeholder="key=ENV_VAR_NAME" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100" />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => patchAndRefresh({
                  name: draftName,
                  network: draftNetwork,
                  model_provider: draftModelProvider,
                  model_name: draftModelName,
                  system_prompt: draftSystemPrompt,
                  env_refs: parseCommaList(draftEnvRefs).flatMap((pair) => {
                    const [keyRaw, envRaw] = pair.split('=').map((item) => item.trim());
                    if (!keyRaw || !envRaw) return [];
                    return [{ key: keyRaw, env_var_name: envRaw, required: true }];
                  }),
                }, 'Agent settings saved.')}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Settings
              </Button>

              {agent.runtime_status === 'running' ? (
                <Button variant="outline" onClick={() => handleStop()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                  Stop
                </Button>
              ) : (
                <Button onClick={() => handleStart()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  Start
                </Button>
              )}

              <Button variant="destructive" onClick={() => handleDelete()} disabled={busy}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
