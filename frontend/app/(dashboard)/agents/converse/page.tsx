'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUp, Bot, Loader2, RefreshCcw, ShieldAlert, Sparkles, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  bootstrapFrontendAgent,
  createChatSession,
  listChatMessages,
  sendChatMessage,
  type AgentChatMessageRecord,
} from '@/lib/sefi-api';
import { cn } from '@/lib/utils';

type ChartPoint = {
  label: string;
  value: number;
};

type ChartModel = {
  title: string;
  points: ChartPoint[];
};

function stripMarkdown(text: string) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(value);
}

function collectNumericSeries(value: unknown, prefix = ''): ChartPoint[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [{ label: prefix || 'value', value }];
  }

  if (Array.isArray(value)) {
    const points: ChartPoint[] = [];
    const capped = value.slice(0, 12);
    for (let i = 0; i < capped.length; i += 1) {
      const entry = capped[i];
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        points.push({ label: `${prefix || 'item'} ${i + 1}`, value: entry });
        continue;
      }
      if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        const numericField = Object.entries(obj).find(([, field]) => typeof field === 'number' && Number.isFinite(field));
        const labelField = Object.entries(obj).find(([, field]) => typeof field === 'string');
        if (numericField) {
          points.push({
            label: String(labelField?.[1] || labelField?.[0] || `${prefix || 'item'} ${i + 1}`),
            value: Number(numericField[1]),
          });
        }
      }
    }
    return points;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const directNumeric = Object.entries(obj)
      .filter(([, entry]) => typeof entry === 'number' && Number.isFinite(entry))
      .map(([key, entry]) => ({ label: key, value: Number(entry) }));
    if (directNumeric.length > 0) {
      return directNumeric.slice(0, 12);
    }

    for (const [key, entry] of Object.entries(obj)) {
      const nested = collectNumericSeries(entry, key);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function buildChartModel(message: AgentChatMessageRecord): ChartModel | null {
  if (message.role !== 'assistant') return null;

  const payload = message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : null;
  if (payload) {
    const result = payload.result ?? payload;
    const points = collectNumericSeries(result, 'metric');
    if (points.length >= 2) {
      const titleSource = payload.mode ? `Result Metrics (${String(payload.mode)})` : 'Result Metrics';
      return {
        title: titleSource,
        points,
      };
    }
  }

  const cleaned = stripMarkdown(message.content || '');
  const words = cleaned.trim() ? cleaned.trim().split(/\s+/).length : 0;
  const lines = cleaned ? cleaned.split(/\n+/).filter((line) => line.trim().length > 0).length : 0;
  const chars = cleaned.length;

  return {
    title: 'Response Profile',
    points: [
      { label: 'chars', value: chars },
      { label: 'words', value: words },
      { label: 'lines', value: lines },
    ],
  };
}

function summarizePayload(message: AgentChatMessageRecord) {
  const payload = message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : null;
  if (!payload) return null;

  const result = payload.result && typeof payload.result === 'object' ? (payload.result as Record<string, unknown>) : null;
  if (!result) return null;

  if (result.requires_confirmation === true) {
    return 'Confirmation required before running this destructive action.';
  }

  if (typeof result.count === 'number') {
    return `Returned ${formatNumber(result.count)} records.`;
  }

  if (typeof result.total === 'number' && typeof result.success_count === 'number') {
    return `Processed ${formatNumber(result.total)} pipelines with ${formatNumber(result.success_count)} successful runs.`;
  }

  const status = result.status && typeof result.status === 'object' ? (result.status as Record<string, unknown>) : null;
  if (status && typeof status.pipelines_total === 'number') {
    return `Pipelines: ${formatNumber(status.pipelines_total)} total, ${formatNumber(Number(status.failed_runs || 0))} failed runs.`;
  }

  return null;
}

function ResultChart({ model }: { model: ChartModel }) {
  const maxValue = Math.max(...model.points.map((point) => point.value), 1);
  const barWidth = 100 / model.points.length;

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3">
      <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{model.title}</p>
      <svg viewBox="0 0 100 50" className="h-40 w-full">
        <line x1="0" y1="49" x2="100" y2="49" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
        {model.points.map((point, index) => {
          const normalized = point.value / maxValue;
          const height = Math.max(2, normalized * 42);
          const x = index * barWidth + 1;
          const y = 48 - height;
          return (
            <g key={`${point.label}-${index}`}>
              <rect
                x={x}
                y={y}
                width={Math.max(1.5, barWidth - 2)}
                height={height}
                rx="0.6"
                fill="url(#barGradient)"
              />
            </g>
          );
        })}
        <defs>
          <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="grid gap-1 text-xs text-zinc-400 sm:grid-cols-2">
        {model.points.slice(0, 6).map((point) => (
          <div key={point.label} className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1">
            <span className="truncate">{point.label}</span>
            <span className="font-mono text-zinc-200">{formatNumber(point.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageCard({ message }: { message: AgentChatMessageRecord }) {
  const isUser = message.role === 'user';
  const cleaned = stripMarkdown(message.content || '');
  const summary = summarizePayload(message);
  const chartModel = buildChartModel(message);

  return (
    <div className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser ? (
        <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300">
          <Bot className="h-4 w-4" />
        </div>
      ) : null}

      <div
        className={cn(
          'max-w-[min(900px,92%)] rounded-2xl border px-4 py-3',
          isUser
            ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50'
            : 'border-white/10 bg-black/30 text-zinc-100'
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.14em]">
          <span className={isUser ? 'text-cyan-200/80' : 'text-zinc-500'}>{isUser ? 'You' : 'Agent'}</span>
          <span className="text-zinc-500">{message.created_at || '-'}</span>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed">{cleaned || '(empty response)'}</p>

        {summary ? <p className="mt-2 text-xs text-zinc-300">{summary}</p> : null}
        {chartModel ? <ResultChart model={chartModel} /> : null}

        {message.status === 'requires_confirmation' ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-amber-300">
            <ShieldAlert className="h-4 w-4" />
            <span>Confirmation needed to continue.</span>
          </div>
        ) : null}
      </div>

      {isUser ? (
        <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-200">
          <User className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}

export default function ConversePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentChatMessageRecord[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))),
    [messages]
  );

  const loadMessages = useCallback(async (targetSessionId: string) => {
    const payload = await listChatMessages(targetSessionId, 200);
    setMessages(payload.records || []);
  }, []);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;

    await bootstrapFrontendAgent();
    const session = await createChatSession({
      title: 'Agents Converse Session',
      auto_execute: true,
    });
    setSessionId(session.id);
    return session.id;
  }, [sessionId]);

  const init = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const id = await ensureSession();
      await loadMessages(id);
      setNotice('Connected to frontend agent API.');
    } catch (initError) {
      setError(initError instanceof Error ? initError.message : 'Failed to initialize conversation');
    } finally {
      setLoading(false);
    }
  }, [ensureSession, loadMessages]);

  useEffect(() => {
    init();
  }, [init]);

  const onSend = useCallback(async () => {
    const message = inputValue.trim();
    if (!message) return;

    try {
      setSending(true);
      setError(null);
      setNotice(null);
      const id = await ensureSession();

      await sendChatMessage(id, {
        message,
        options: {
          auto_execute: true,
          allow_sql_fallback: false,
          max_rows: 200,
        },
      });

      setInputValue('');
      await loadMessages(id);
      setNotice('Response received.');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [ensureSession, inputValue, loadMessages]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/10 bg-black/35 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agents / Converse</p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-100">Live Frontend Agent Chat</h1>
            <p className="mt-1 text-sm text-zinc-400">
              This chat is wired to the backend session APIs and renders plain-text responses with custom charts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {sessionId ? <Badge variant="outline">session {sessionId.slice(0, 8)}</Badge> : null}
            <Button variant="ghost" onClick={() => init()} disabled={loading || sending}>
              <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
          <CardDescription>No markdown rendering. Outputs are displayed as plain text with per-answer charts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading chat session...
            </div>
          ) : sortedMessages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/15 bg-black/25 p-4 text-sm text-zinc-500">
              Ask a question to start.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedMessages.map((message) => (
                <MessageCard key={message.id} message={message} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ask Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="Ask about vault diagnostics, pipelines, sources, or semantic query insights..."
              className="min-h-[72px] flex-1 resize-y rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-400/40 focus:outline-none"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void onSend();
                }
              }}
            />
            <Button onClick={() => void onSend()} disabled={sending || loading || !inputValue.trim()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Tip: press Cmd/Ctrl + Enter to send.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
