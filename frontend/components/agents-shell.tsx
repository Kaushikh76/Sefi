'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Bot, Brain, FlaskConical, Gauge, Layers, MessagesSquare, Settings, Sparkles, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

type AgentsShellProps = {
  children: React.ReactNode;
};

type AgentContext = {
  agentId: string | null;
  tab: string | null;
  mode: 'manager' | 'new' | 'playground' | 'topics' | 'converse' | 'agent';
};

const AGENT_TABS = [
  { key: 'brainstorm', label: 'Brainstorm', icon: Brain },
  { key: 'semantic', label: 'Semantic', icon: Layers },
  { key: 'tools', label: 'Tools', icon: Workflow },
  { key: 'automations', label: 'Automations', icon: Gauge },
  { key: 'publish', label: 'Publish', icon: Sparkles },
  { key: 'activity', label: 'Activity', icon: FlaskConical },
  { key: 'settings', label: 'Settings', icon: Settings },
];

function parseAgentContext(pathname: string): AgentContext {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'agents') {
    return { agentId: null, tab: null, mode: 'manager' };
  }
  if (!segments[1]) return { agentId: null, tab: null, mode: 'manager' };
  if (segments[1] === 'new') return { agentId: null, tab: null, mode: 'new' };
  if (segments[1] === 'playground') return { agentId: null, tab: null, mode: 'playground' };
  if (segments[1] === 'topics') return { agentId: null, tab: null, mode: 'topics' };
  if (segments[1] === 'converse') return { agentId: null, tab: null, mode: 'converse' };
  return {
    agentId: segments[1],
    tab: segments[2] || 'brainstorm',
    mode: 'agent',
  };
}

export function AgentsShell({ children }: AgentsShellProps) {
  const pathname = usePathname();
  const [backHref, setBackHref] = useState('/indexing/overview');
  const context = useMemo(() => parseAgentContext(pathname), [pathname]);
  const converseActive = pathname?.startsWith('/agents/converse') ?? false;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const candidate = window.sessionStorage.getItem('sefi:last-non-agent-path');
    if (candidate && candidate.startsWith('/')) {
      setBackHref(candidate);
    }
  }, []);

  return (
    <div className="grid min-h-full gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <Link href={backHref} className="mb-4 flex items-center gap-2 text-sm text-zinc-300 hover:text-zinc-100">
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Main Sidebar</span>
        </Link>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agents</p>
          <p className="mt-1 text-sm text-zinc-200">Manager Workspace</p>
        </div>

        <nav className="mt-4 space-y-1">
          <Link
            href="/agents"
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
              context.mode === 'manager' ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            )}
          >
            <Bot className="h-4 w-4" />
            <span>Manager</span>
          </Link>
          <Link
            href="/agents/new"
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
              context.mode === 'new' ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            )}
          >
            <Sparkles className="h-4 w-4" />
            <span>Create New</span>
          </Link>
          <Link
            href="/agents/playground"
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
              context.mode === 'playground' ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            )}
          >
            <FlaskConical className="h-4 w-4" />
            <span>Playground</span>
          </Link>
          <Link
            href="/agents/topics"
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
              context.mode === 'topics' ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            )}
          >
            <MessagesSquare className="h-4 w-4" />
            <span>Topic Manager</span>
          </Link>
          <Link
            href="/agents/converse"
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
              converseActive ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            )}
          >
            <Sparkles className="h-4 w-4" />
            <span>Converse</span>
          </Link>
        </nav>

        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Agent Tabs</p>
          <div className="space-y-1">
            {AGENT_TABS.map((tab) => {
              const href = context.agentId ? `/agents/${context.agentId}/${tab.key}` : '/agents/new';
              const active = context.mode === 'agent' && context.tab === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={href}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    active ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {context.mode !== 'agent' ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/20 p-3 text-xs text-zinc-400">
            Select or create an agent to unlock Brainstorm, Semantic, Tools, Automations, Publish, Activity, and Settings tabs.
          </div>
        ) : null}
      </aside>

      <section className="min-w-0">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-6">{children}</div>
      </section>
    </div>
  );
}
