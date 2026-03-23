'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, WandSparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  bootstrapBonzoClmmGuardAgent,
  createManagedAgent,
  getCubeMeta,
  type CubeMetaResponse,
  type ManagedAgentCreateInput,
  type ManagedAgentType,
} from '@/lib/sefi-api';

const BASE_HEDERA_TOOLS = [
  'sefi.semantic.context',
  'sefi.semantic.query',
  'sefi.semantic.summarize',
  'hedera.hcs.create',
  'hedera.hcs.publish',
  'hedera.network.read',
];
const BASE_ELIZA_TOOLS = [
  '@elizaos/plugin-bootstrap',
  '@elizaos/plugin-hedera',
  'plugin-sefi-semantic',
  '@elizaos/plugin-twitter',
];

const MODEL_OPTIONS = [
  { provider: 'openai', name: 'gpt-5-mini', label: 'OpenAI / gpt-5-mini (fast)' },
  { provider: 'openai', name: 'gpt-5', label: 'OpenAI / gpt-5 (strong)' },
  { provider: 'openai', name: 'gpt-4.1-mini', label: 'OpenAI / gpt-4.1-mini (compat)' },
];

const TIME_WINDOWS = ['1h', '6h', '24h', '7d', '30d'];

type CreatePreset = {
  key: string;
  label: string;
  description: string;
  type: ManagedAgentType;
  name: string;
  network: string;
  model_provider: string;
  model_name: string;
  system_prompt: string;
  topics: string[];
  tools: string[];
  schedule: {
    enabled: boolean;
    interval_minutes: number;
    action: string;
  };
  semantic_scope: {
    allowed_cubes: string[];
    allowed_members: string[];
    time_window: string;
    max_rows: number;
  };
  env_refs_text: string;
};

const PRESETS: CreatePreset[] = [
  {
    key: 'bonzo_clmm_guard',
    label: 'Bonzo CLMM Volatility Guard',
    description:
      'Monitors volatility regime and recommends tighten/widen/single-sided CLMM stance. Runs every 10 minutes.',
    type: 'hedera',
    name: 'Bonzo CLMM Volatility Guard',
    network: 'testnet',
    model_provider: 'openai',
    model_name: 'gpt-5-mini',
    system_prompt: [
      'Monitor Bonzo concentrated liquidity vault exposure.',
      'Detect low/high volatility regime with explicit thresholds.',
      'Low volatility: tighten ranges for fee efficiency.',
      'High volatility: widen ranges or switch to single-sided protection.',
      'Every recommendation must include action and confidence.',
    ].join('\n'),
    topics: ['bonzo', 'clmm', 'volatility', 'risk watch'],
    tools: BASE_HEDERA_TOOLS,
    schedule: {
      enabled: true,
      interval_minutes: 10,
      action: 'bonzo_clmm_guard',
    },
    semantic_scope: {
      allowed_cubes: ['stats', 'hts_transfers', 'erc20_transfers', 'hbar_transfers'],
      allowed_members: [],
      time_window: '24h',
      max_rows: 300,
    },
    env_refs_text: 'hedera_account_id=SEFI_HEDERA_ACCOUNT_ID, hedera_private_key=SEFI_HEDERA_PRIVATE_KEY',
  },
  {
    key: 'market_pulse',
    label: 'Market Pulse Reporter',
    description: 'General recurring protocol summaries with semantic metrics and HCS posting.',
    type: 'hedera',
    name: 'SeFi Market Pulse',
    network: 'testnet',
    model_provider: 'openai',
    model_name: 'gpt-5-mini',
    system_prompt: 'Generate concise protocol summaries backed by semantic metrics.',
    topics: ['market pulse', 'protocol updates'],
    tools: BASE_HEDERA_TOOLS,
    schedule: {
      enabled: true,
      interval_minutes: 60,
      action: 'publish_test',
    },
    semantic_scope: {
      allowed_cubes: ['stats', 'contracts', 'hts_transfers'],
      allowed_members: [],
      time_window: '24h',
      max_rows: 200,
    },
    env_refs_text: 'hedera_account_id=SEFI_HEDERA_ACCOUNT_ID, hedera_private_key=SEFI_HEDERA_PRIVATE_KEY',
  },
  {
    key: 'eliza_social',
    label: 'Eliza Social Analyst',
    description: 'Eliza sidecar profile for social-ready updates with optional Twitter posting.',
    type: 'elizaos',
    name: 'SeFi Eliza Social Analyst',
    network: 'testnet',
    model_provider: 'openai',
    model_name: 'gpt-5-mini',
    system_prompt: 'Produce social-ready updates with clear metric context.',
    topics: ['social', 'community pulse'],
    tools: BASE_ELIZA_TOOLS,
    schedule: {
      enabled: true,
      interval_minutes: 120,
      action: 'publish_test',
    },
    semantic_scope: {
      allowed_cubes: ['stats', 'topic_messages'],
      allowed_members: [],
      time_window: '24h',
      max_rows: 150,
    },
    env_refs_text: 'eliza_openai_api_key=OPENAI_API_KEY, twitter_api_key=SEFI_TWITTER_API_KEY',
  },
];

function parseCommaList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvRefs(value: string) {
  return parseCommaList(value).flatMap((pair) => {
    const [keyRaw, envRaw] = pair.split('=').map((item) => item.trim());
    if (!keyRaw || !envRaw) return [];
    return [{ key: keyRaw, env_var_name: envRaw, required: true }];
  });
}

export default function NewAgentPage() {
  const router = useRouter();
  const [presetKey, setPresetKey] = useState(PRESETS[0].key);
  const [creating, setCreating] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<ManagedAgentType>('hedera');
  const [name, setName] = useState('SeFi Agent');
  const [network, setNetwork] = useState('testnet');
  const [modelProvider, setModelProvider] = useState('openai');
  const [modelName, setModelName] = useState('gpt-5-mini');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [topicsText, setTopicsText] = useState('market pulse, risk watch');
  const [envRefsText, setEnvRefsText] = useState(
    'hedera_account_id=SEFI_HEDERA_ACCOUNT_ID, hedera_private_key=SEFI_HEDERA_PRIVATE_KEY'
  );

  const [semanticTimeWindow, setSemanticTimeWindow] = useState('24h');
  const [semanticMaxRows, setSemanticMaxRows] = useState(200);
  const [selectedCubes, setSelectedCubes] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>(BASE_HEDERA_TOOLS);

  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState(10);
  const [scheduleTimezone, setScheduleTimezone] = useState('UTC');
  const [scheduleAction, setScheduleAction] = useState('publish_test');
  const [scheduleQuestion, setScheduleQuestion] = useState('Generate a semantic summary for recent protocol activity.');
  const [scheduleSummary, setScheduleSummary] = useState('Scheduled protocol summary update.');
  const [scheduleVoice, setScheduleVoice] = useState('Keep this concise and operator-friendly.');

  const [cubeMeta, setCubeMeta] = useState<CubeMetaResponse | null>(null);
  const [cubeLoading, setCubeLoading] = useState(false);
  const [cubeError, setCubeError] = useState<string | null>(null);

  useEffect(() => {
    const preset = PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;

    setType(preset.type);
    setName(preset.name);
    setNetwork(preset.network);
    setModelProvider(preset.model_provider);
    setModelName(preset.model_name);
    setSystemPrompt(preset.system_prompt);
    setTopicsText(preset.topics.join(', '));
    setEnvRefsText(preset.env_refs_text);
    setSelectedTools([...preset.tools]);
    setSelectedCubes([...preset.semantic_scope.allowed_cubes]);
    setSelectedMembers([...preset.semantic_scope.allowed_members]);
    setSemanticTimeWindow(preset.semantic_scope.time_window);
    setSemanticMaxRows(preset.semantic_scope.max_rows);
    setScheduleEnabled(preset.schedule.enabled);
    setScheduleIntervalMinutes(preset.schedule.interval_minutes);
    setScheduleAction(preset.schedule.action);
  }, [presetKey]);

  useEffect(() => {
    let active = true;
    const loadCubeMeta = async () => {
      try {
        setCubeLoading(true);
        setCubeError(null);
        const meta = await getCubeMeta();
        if (!active) return;
        setCubeMeta(meta);
      } catch (metaError) {
        if (!active) return;
        setCubeError(metaError instanceof Error ? metaError.message : 'Failed to load cube metadata');
      } finally {
        if (active) {
          setCubeLoading(false);
        }
      }
    };
    loadCubeMeta();
    return () => {
      active = false;
    };
  }, []);

  const memberOptions = useMemo(() => {
    const cubes = cubeMeta?.cubes || [];
    const allowedCubeSet = new Set(selectedCubes);
    const members = cubes.flatMap((cube) => {
      if (!allowedCubeSet.has(cube.name)) return [];
      const measures = (cube.measures || []).map((measure) => measure.name);
      const dimensions = (cube.dimensions || []).map((dimension) => dimension.name);
      return [...measures, ...dimensions];
    });
    return Array.from(new Set(members)).sort((a, b) => a.localeCompare(b));
  }, [cubeMeta?.cubes, selectedCubes]);

  const envRefsPreview = useMemo(() => parseEnvRefs(envRefsText), [envRefsText]);

  const availableTools = useMemo(() => {
    return type === 'hedera' ? BASE_HEDERA_TOOLS : BASE_ELIZA_TOOLS;
  }, [type]);

  const handleBootstrapBonzo = async () => {
    try {
      setBootstrapping(true);
      setError(null);
      const result = await bootstrapBonzoClmmGuardAgent();
      router.push(`/agents/${result.agent.id}/brainstorm`);
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : 'Failed to bootstrap Bonzo agent');
    } finally {
      setBootstrapping(false);
    }
  };

  const handleCreate = async () => {
    try {
      setCreating(true);
      setError(null);

      const intervalMinutes = Math.max(1, Math.min(24 * 60, Math.trunc(Number(scheduleIntervalMinutes) || 10)));
      const payload: ManagedAgentCreateInput = {
        name: name.trim() || (type === 'hedera' ? 'Hedera Agent' : 'ElizaOS Agent'),
        type,
        network: network.trim() || 'testnet',
        model_provider: modelProvider.trim() || 'openai',
        model_name: modelName.trim() || 'gpt-5-mini',
        system_prompt: systemPrompt.trim(),
        topics: parseCommaList(topicsText),
        semantic_scope: {
          allowed_cubes: selectedCubes,
          allowed_members: selectedMembers,
          time_window: semanticTimeWindow || '24h',
          max_rows: Math.max(1, Math.min(2000, Math.trunc(Number(semanticMaxRows) || 200))),
        },
        tool_allowlist: selectedTools,
        schedule: {
          enabled: scheduleEnabled,
          cadence: 'interval',
          interval_minutes: intervalMinutes,
          timezone: scheduleTimezone || 'UTC',
          cron: `*/${intervalMinutes} * * * *`,
          action: scheduleAction,
          question: scheduleQuestion,
          summary: scheduleSummary,
          voice_text: scheduleVoice,
        },
        publish_targets: {
          hcs: { enabled: true, create_if_missing: true },
          twitter: { enabled: type === 'elizaos' },
        },
        env_refs: envRefsPreview,
      };

      const created = await createManagedAgent(payload);
      router.push(`/agents/${created.id}/brainstorm`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create agent');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-white/10 bg-black/30 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agents / Creation</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Create New Agent</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Use labeled presets, choose semantic cubes/members, and configure automation behavior without guessing field meanings.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => handleBootstrapBonzo()} disabled={bootstrapping}>
            {bootstrapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            Bootstrap Bonzo CLMM Guard (Backend)
          </Button>
          {error ? <Badge variant="warning">{error}</Badge> : null}
          {cubeError ? <Badge variant="warning">{cubeError}</Badge> : null}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Preset</CardTitle>
          <CardDescription>Choose a preset to auto-fill runtime, semantic scope, and schedule defaults.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-sm text-zinc-300" htmlFor="preset">
            Agent Preset
          </label>
          <select
            id="preset"
            value={presetKey}
            onChange={(event) => setPresetKey(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
          >
            {PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-400">
            {PRESETS.find((item) => item.key === presetKey)?.description}
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Core Settings</CardTitle>
            <CardDescription>Clearly labeled runtime identity and model controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block text-sm text-zinc-300" htmlFor="agentType">Runtime Type</label>
            <select
              id="agentType"
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as ManagedAgentType;
                setType(nextType);
                setSelectedTools(nextType === 'hedera' ? [...BASE_HEDERA_TOOLS] : [...BASE_ELIZA_TOOLS]);
              }}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="hedera">Hedera Agent</option>
              <option value="elizaos">ElizaOS Agent</option>
            </select>

            <label className="block text-sm text-zinc-300" htmlFor="agentName">Agent Name</label>
            <input
              id="agentName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bonzo CLMM Volatility Guard"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm text-zinc-300" htmlFor="network">Network</label>
                <select
                  id="network"
                  value={network}
                  onChange={(event) => setNetwork(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="testnet">testnet</option>
                  <option value="mainnet">mainnet</option>
                  <option value="previewnet">previewnet</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-300" htmlFor="model">Model</label>
                <select
                  id="model"
                  value={`${modelProvider}:${modelName}`}
                  onChange={(event) => {
                    const [provider, model] = event.target.value.split(':');
                    setModelProvider(provider || 'openai');
                    setModelName(model || 'gpt-5-mini');
                  }}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={`${option.provider}:${option.name}`} value={`${option.provider}:${option.name}`}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="block text-sm text-zinc-300" htmlFor="topics">Topic Tags (comma separated)</label>
            <input
              id="topics"
              value={topicsText}
              onChange={(event) => setTopicsText(event.target.value)}
              placeholder="bonzo, clmm, volatility"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />

            <label className="block text-sm text-zinc-300" htmlFor="systemPrompt">System Prompt</label>
            <textarea
              id="systemPrompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              rows={5}
              placeholder="Agent mission and output rules..."
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Semantic Scope</CardTitle>
            <CardDescription>Choose cubes and members from live metadata, with optional auto-fill.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm text-zinc-300" htmlFor="timeWindow">Time Window</label>
                <select
                  id="timeWindow"
                  value={semanticTimeWindow}
                  onChange={(event) => setSemanticTimeWindow(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
                >
                  {TIME_WINDOWS.map((window) => (
                    <option key={window} value={window}>{window}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-300" htmlFor="maxRows">Max Rows</label>
                <input
                  id="maxRows"
                  type="number"
                  value={semanticMaxRows}
                  min={1}
                  max={2000}
                  onChange={(event) => setSemanticMaxRows(Number(event.target.value || 200))}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm text-zinc-200">Allowed Cubes</p>
                {cubeLoading ? <span className="text-xs text-zinc-500">Loading...</span> : null}
              </div>
              <div className="max-h-36 space-y-1 overflow-auto pr-1 text-sm">
                {(cubeMeta?.cubes || []).map((cube) => (
                  <label key={cube.name} className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-2 py-1">
                    <span className="text-zinc-200">{cube.title || cube.name}</span>
                    <input
                      type="checkbox"
                      checked={selectedCubes.includes(cube.name)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedCubes((current) => Array.from(new Set([...current, cube.name])));
                        } else {
                          setSelectedCubes((current) => current.filter((item) => item !== cube.name));
                        }
                      }}
                    />
                  </label>
                ))}
                {(cubeMeta?.cubes || []).length === 0 ? (
                  <p className="text-xs text-zinc-500">No cube metadata available right now.</p>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm text-zinc-200">Allowed Members</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedMembers(memberOptions)}
                >
                  Auto-fill
                </Button>
              </div>
              <div className="max-h-44 space-y-1 overflow-auto pr-1 text-sm">
                {memberOptions.map((member) => (
                  <label key={member} className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-2 py-1">
                    <span className="font-mono text-xs text-zinc-200">{member}</span>
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(member)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedMembers((current) => Array.from(new Set([...current, member])));
                        } else {
                          setSelectedMembers((current) => current.filter((item) => item !== member));
                        }
                      }}
                    />
                  </label>
                ))}
                {memberOptions.length === 0 ? (
                  <p className="text-xs text-zinc-500">Select cubes first to choose members.</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tools And Env References</CardTitle>
            <CardDescription>Toggle tools/plugins and clearly label environment variable mappings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
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
            </div>

            <label className="block text-sm text-zinc-300" htmlFor="envRefs">
              Env References (`key=ENV_VAR`, comma separated)
            </label>
            <textarea
              id="envRefs"
              value={envRefsText}
              onChange={(event) => setEnvRefsText(event.target.value)}
              rows={4}
              placeholder="hedera_account_id=SEFI_HEDERA_ACCOUNT_ID, hedera_private_key=SEFI_HEDERA_PRIVATE_KEY"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Parsed Env References</p>
              <div className="mt-2 space-y-1 text-xs text-zinc-300">
                {envRefsPreview.length === 0 ? (
                  <p>No valid entries yet.</p>
                ) : (
                  envRefsPreview.map((item) => <p key={item.key}>{item.key} {'->'} {item.env_var_name}</p>)
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automation Setup</CardTitle>
            <CardDescription>Choose what to automate, how often, and the generated content style.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
              <span>Schedule Enabled</span>
              <input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm text-zinc-300" htmlFor="intervalMinutes">Interval (minutes)</label>
                <input
                  id="intervalMinutes"
                  type="number"
                  value={scheduleIntervalMinutes}
                  min={1}
                  max={1440}
                  onChange={(event) => setScheduleIntervalMinutes(Number(event.target.value || 10))}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-300" htmlFor="scheduleTimezone">Timezone</label>
                <input
                  id="scheduleTimezone"
                  value={scheduleTimezone}
                  onChange={(event) => setScheduleTimezone(event.target.value)}
                  placeholder="UTC"
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
                />
              </div>
            </div>

            <label className="block text-sm text-zinc-300" htmlFor="scheduleAction">Automation Action</label>
            <select
              id="scheduleAction"
              value={scheduleAction}
              onChange={(event) => setScheduleAction(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="publish_test">Semantic Publish Run</option>
              <option value="bonzo_clmm_guard">Bonzo CLMM Volatility Guard</option>
            </select>

            <label className="block text-sm text-zinc-300" htmlFor="scheduleQuestion">Automation Question</label>
            <textarea
              id="scheduleQuestion"
              value={scheduleQuestion}
              onChange={(event) => setScheduleQuestion(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />

            <label className="block text-sm text-zinc-300" htmlFor="scheduleSummary">Summary Template</label>
            <textarea
              id="scheduleSummary"
              value={scheduleSummary}
              onChange={(event) => setScheduleSummary(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />

            <label className="block text-sm text-zinc-300" htmlFor="scheduleVoice">Voice Style</label>
            <textarea
              id="scheduleVoice"
              value={scheduleVoice}
              onChange={(event) => setScheduleVoice(event.target.value)}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
            />
          </CardContent>
        </Card>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create Agent
        </Button>
      </div>
    </div>
  );
}

