'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessagesSquare, PauseCircle, PlayCircle, Plus, RefreshCw, WandSparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  bootstrapBonzoClmmGuardAgent,
  listManagedAgents,
  startManagedAgent,
  stopManagedAgent,
  type ManagedAgentRecord,
} from '@/lib/sefi-api';

export default function AgentsManagerPage() {
  const [agents, setAgents] = useState<ManagedAgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const payload = await listManagedAgents();
      setAgents(payload.records);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleStart = useCallback(async (agentId: string) => {
    try {
      setBusyAgentId(agentId);
      setError(null);
      await startManagedAgent(agentId);
      await refresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Failed to start agent');
    } finally {
      setBusyAgentId(null);
    }
  }, [refresh]);

  const handleStop = useCallback(async (agentId: string) => {
    try {
      setBusyAgentId(agentId);
      setError(null);
      await stopManagedAgent(agentId);
      await refresh();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Failed to stop agent');
    } finally {
      setBusyAgentId(null);
    }
  }, [refresh]);

  const handleBootstrapBonzo = useCallback(async () => {
    try {
      setBootstrapping(true);
      setError(null);
      await bootstrapBonzoClmmGuardAgent();
      await refresh();
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : 'Failed to bootstrap Bonzo agent');
    } finally {
      setBootstrapping(false);
    }
  }, [refresh]);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-white/10 bg-black/30 p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agents / Manager</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Agent Manager Dashboard</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Monitor current runtime activity, review run telemetry, and create new Hedera or ElizaOS agents.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/agents/new">
            <Button>
              <Plus className="h-4 w-4" />
              Create New Agent
            </Button>
          </Link>
          <Button variant="secondary" onClick={() => handleBootstrapBonzo()} disabled={bootstrapping}>
            {bootstrapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            Bootstrap Bonzo Guard
          </Button>
          <Link href="/agents/topics">
            <Button variant="outline">
              <MessagesSquare className="h-4 w-4" />
              Topic Manager
            </Button>
          </Link>
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
              <CardTitle>Loading Agents</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-zinc-400">Fetching current agent registry...</CardContent>
          </Card>
        ) : agents.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No Agents Yet</CardTitle>
              <CardDescription>Create your first Hedera or ElizaOS agent to begin.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/agents/new">
                <Button>
                  <Plus className="h-4 w-4" />
                  Create Agent
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>{agent.name}</CardTitle>
                    <CardDescription>
                      {agent.type} / {agent.network}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      agent.runtime_status === 'running'
                        ? 'success'
                        : agent.runtime_status === 'degraded'
                          ? 'warning'
                          : 'outline'
                    }
                  >
                    {agent.runtime_status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <p>Runs</p>
                    <p className="mt-1 text-sm text-zinc-100">{agent.run_count}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <p>Events</p>
                    <p className="mt-1 text-sm text-zinc-100">{agent.event_count}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <p>Topics</p>
                    <p className="mt-1 text-sm text-zinc-100">{agent.topic_registrations?.length ?? 0}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link href={`/agents/${agent.id}/brainstorm`}>
                    <Button size="sm" variant="secondary">
                      Open Workspace
                    </Button>
                  </Link>
                  {agent.runtime_status === 'running' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStop(agent.id)}
                      disabled={busyAgentId === agent.id}
                    >
                      {busyAgentId === agent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleStart(agent.id)}
                      disabled={busyAgentId === agent.id}
                    >
                      {busyAgentId === agent.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                      Start
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
