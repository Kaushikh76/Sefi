'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listManagedAgentTopics, type ManagedAgentTopicRecord } from '@/lib/sefi-api';

function formatTimestamp(value: string | null) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function AgentTopicsPage() {
  const [topics, setTopics] = useState<ManagedAgentTopicRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await listManagedAgentTopics();
      setTopics(payload.records);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load agent topics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-white/10 bg-black/30 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agents / Topic Manager</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Hedera Topic Manager</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Review agent-managed HCS topics, inspect ownership details, and open any topic directly in HashScan.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
          {error ? <Badge variant="warning">{error}</Badge> : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading Topics</CardTitle>
              <CardDescription>Fetching agent topic registrations...</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-zinc-400">Please wait.</CardContent>
          </Card>
        ) : topics.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Topics Yet</CardTitle>
              <CardDescription>Create an agent and run publish test to create/register HCS topics.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/agents/new">
                <Button>Create Agent</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          topics.map((topic) => (
            <Card key={`${topic.agent_id}:${topic.network}:${topic.topic_id}`}>
              <CardHeader>
                <CardTitle>{topic.label || topic.topic_id}</CardTitle>
                <CardDescription>{topic.agent_name || topic.agent_id}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Topic ID</p>
                  <p className="mt-1 font-mono text-zinc-100">{topic.topic_id}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <p className="text-zinc-500">Network</p>
                    <p className="mt-1 text-zinc-100">{topic.network}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <p className="text-zinc-500">Created</p>
                    <p className="mt-1 text-zinc-100">{formatTimestamp(topic.created_at)}</p>
                  </div>
                </div>
                <a href={topic.explorer_url} target="_blank" rel="noreferrer">
                  <Button variant="secondary" className="w-full">
                    <ExternalLink className="h-4 w-4" />
                    Open In Hedera Explorer
                  </Button>
                </a>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

