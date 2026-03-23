'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Braces, Copy, Database, Loader2, Play, RefreshCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  getCubeMeta,
  runCubeQuery,
  runSqliteQuery,
  type CubeMetaResponse,
  type CubeQueryProxyResponse,
  type SqliteQueryResponse,
} from '@/lib/sefi-api';
import { formatServiceState, useSharedStatus } from '@/lib/status-store';

type MemberKind = 'measure' | 'dimension';

type MemberItem = {
  id: string;
  name: string;
  type: MemberKind;
  cubeName: string;
  title: string;
};

const RECENT_STORAGE_KEY = 'sefi-query-lab-recent-members';
const VIRTUAL_ROW_HEIGHT = 36;
const VIRTUAL_CONTAINER_HEIGHT = 360;

function stringifyPretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function fuzzyScore(candidate: string, query: string) {
  const target = candidate.toLowerCase();
  const input = query.toLowerCase().trim();
  if (!input) return 1;
  if (target.includes(input)) return 100 - target.indexOf(input);

  let score = 0;
  let pointer = 0;
  for (let i = 0; i < input.length; i += 1) {
    const nextIndex = target.indexOf(input[i], pointer);
    if (nextIndex === -1) return 0;
    score += 2;
    if (nextIndex === pointer) score += 1;
    pointer = nextIndex + 1;
  }
  return score;
}

function buildMemberCatalog(meta: CubeMetaResponse | null): MemberItem[] {
  const cubes = meta?.cubes || [];
  const members: MemberItem[] = [];

  for (const cube of cubes) {
    const cubeName = cube.name || 'unknown';

    for (const measure of cube.measures || []) {
      if (!measure?.name) continue;
      members.push({
        id: `measure:${measure.name}`,
        name: measure.name,
        type: 'measure',
        cubeName,
        title: measure.title || measure.name,
      });
    }

    for (const dimension of cube.dimensions || []) {
      if (!dimension?.name) continue;
      members.push({
        id: `dimension:${dimension.name}`,
        name: dimension.name,
        type: 'dimension',
        cubeName,
        title: dimension.title || dimension.name,
      });
    }
  }

  return members.sort((a, b) => {
    if (a.cubeName !== b.cubeName) return a.cubeName.localeCompare(b.cubeName);
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });
}

function parseRecentMemberIds(rawValue: string | null): string[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => typeof value === 'string').slice(0, 20);
  } catch {
    return [];
  }
}

function updateRecentMembers(existing: string[], nextId: string): string[] {
  const deduped = [nextId, ...existing.filter((item) => item !== nextId)];
  return deduped.slice(0, 20);
}

function insertMemberIntoQueryDraft(queryDraft: string, member: MemberItem): string {
  const parsed = JSON.parse(queryDraft) as Record<string, unknown>;

  if (!Array.isArray(parsed.measures)) {
    parsed.measures = [];
  }
  if (!Array.isArray(parsed.dimensions)) {
    parsed.dimensions = [];
  }
  if (!Array.isArray(parsed.timeDimensions)) {
    parsed.timeDimensions = [];
  }

  if (member.type === 'measure') {
    const measures = parsed.measures as string[];
    if (!measures.includes(member.name)) {
      measures.push(member.name);
    }
  } else {
    const dimensions = parsed.dimensions as string[];
    if (!dimensions.includes(member.name)) {
      dimensions.push(member.name);
    }
  }

  return stringifyPretty(parsed);
}

function collectFilterMembers(filters: unknown): string[] {
  if (!Array.isArray(filters)) return [];
  const members: string[] = [];
  const stack = [...filters];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== 'object') continue;
    const typedItem = item as Record<string, unknown>;
    if (typeof typedItem.member === 'string') {
      members.push(typedItem.member);
    }
    if (Array.isArray(typedItem.or)) {
      stack.push(...typedItem.or);
    }
    if (Array.isArray(typedItem.and)) {
      stack.push(...typedItem.and);
    }
  }
  return members;
}

function collectSemanticMembers(query: Record<string, unknown>): string[] {
  const members: string[] = [];

  const measures = Array.isArray(query.measures) ? query.measures : [];
  const dimensions = Array.isArray(query.dimensions) ? query.dimensions : [];
  for (const measure of measures) {
    if (typeof measure === 'string') members.push(measure);
  }
  for (const dimension of dimensions) {
    if (typeof dimension === 'string') members.push(dimension);
  }

  const timeDimensions = Array.isArray(query.timeDimensions) ? query.timeDimensions : [];
  for (const item of timeDimensions) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as Record<string, unknown>;
    if (typeof typed.dimension === 'string') members.push(typed.dimension);
  }

  members.push(...collectFilterMembers(query.filters));

  if (query.order && typeof query.order === 'object' && !Array.isArray(query.order)) {
    members.push(...Object.keys(query.order));
  } else if (Array.isArray(query.order)) {
    for (const item of query.order) {
      if (typeof item === 'string') {
        members.push(item);
      } else if (item && typeof item === 'object') {
        const typed = item as Record<string, unknown>;
        if (typeof typed.id === 'string') members.push(typed.id);
        if (typeof typed.member === 'string') members.push(typed.member);
      }
    }
  }

  return members;
}

export default function QueryLabPage() {
  const sharedStatus = useSharedStatus();
  const cubeState = sharedStatus.cube;
  const cubeReady = cubeState === 'up';
  const [tab, setTab] = useState<'cube' | 'sql'>('cube');
  const [cubeMeta, setCubeMeta] = useState<CubeMetaResponse | null>(null);
  const [queryDraft, setQueryDraft] = useState(
    stringifyPretty({
      measures: ['stats.count'],
      dimensions: [],
      timeDimensions: [],
      limit: 100,
    })
  );
  const [cubeResult, setCubeResult] = useState<CubeQueryProxyResponse | null>(null);
  const [cubeSqlResult, setCubeSqlResult] = useState<CubeQueryProxyResponse | null>(null);
  const [sqlDraft, setSqlDraft] = useState('SELECT key, value, updated_at FROM stats ORDER BY key LIMIT 50');
  const [sqlResult, setSqlResult] = useState<SqliteQueryResponse | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [executing, setExecuting] = useState<'cube' | 'cube-sql' | 'sql' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [activeMemberIndex, setActiveMemberIndex] = useState(0);
  const [recentMemberIds, setRecentMemberIds] = useState<string[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const explorerRef = useRef<HTMLDivElement | null>(null);

  const loadMeta = useCallback(async () => {
    if (!cubeReady) {
      setLoadingMeta(false);
      setError(`Cube is ${formatServiceState(cubeState)}. Switch to SQL tab while Cube recovers.`);
      return;
    }

    try {
      setError(null);
      setLoadingMeta(true);
      const meta = await getCubeMeta();
      setCubeMeta(meta);
    } catch (metaError) {
      setError(metaError instanceof Error ? metaError.message : 'Failed to load cube metadata');
    } finally {
      setLoadingMeta(false);
    }
  }, [cubeReady, cubeState]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const stored = parseRecentMemberIds(window.localStorage.getItem(RECENT_STORAGE_KEY));
    setRecentMemberIds(stored);
  }, []);

  const parsedCubeQuery = useMemo(() => {
    try {
      return JSON.parse(queryDraft) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [queryDraft]);

  const allMembers = useMemo(() => buildMemberCatalog(cubeMeta), [cubeMeta]);

  const semanticValidationErrors = useMemo(() => {
    if (!parsedCubeQuery) return [];
    const allowlist = new Set(allMembers.map((item) => item.name.toLowerCase()));
    const usedMembers = collectSemanticMembers(parsedCubeQuery);
    const unknownMembers = [...new Set(usedMembers.filter((member) => !allowlist.has(member.toLowerCase())))];
    return unknownMembers.map((member) => `Unknown semantic member: ${member}`);
  }, [allMembers, parsedCubeQuery]);

  const queryReadyForExecution = parsedCubeQuery && semanticValidationErrors.length === 0;

  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return allMembers;
    const normalized = memberSearch.trim().toLowerCase();

    return allMembers
      .map((member) => {
        const score = Math.max(
          fuzzyScore(member.name, normalized),
          fuzzyScore(member.cubeName, normalized),
          fuzzyScore(member.title, normalized),
          fuzzyScore(member.type, normalized)
        );
        return { member, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.member.name.localeCompare(b.member.name);
      })
      .map((entry) => entry.member);
  }, [allMembers, memberSearch]);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberItem>();
    for (const member of allMembers) {
      map.set(member.id, member);
    }
    return map;
  }, [allMembers]);

  const recentMembers = useMemo(() => {
    return recentMemberIds.map((id) => memberById.get(id)).filter((member): member is MemberItem => Boolean(member));
  }, [memberById, recentMemberIds]);

  const flattenedRows = useMemo(() => {
    const rows: Array<{ kind: 'header'; label: string } | { kind: 'member'; item: MemberItem }> = [];
    const grouped = new Map<string, MemberItem[]>();

    for (const member of filteredMembers) {
      const key = member.cubeName;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)?.push(member);
    }

    const entries = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [cubeName, members] of entries) {
      rows.push({ kind: 'header', label: cubeName });
      for (const member of members) {
        rows.push({ kind: 'member', item: member });
      }
    }

    return rows;
  }, [filteredMembers]);

  const activeMember = filteredMembers[activeMemberIndex] || null;

  const flattenedRowIndexByMemberId = useMemo(() => {
    const map = new Map<string, number>();
    for (let index = 0; index < flattenedRows.length; index += 1) {
      const row = flattenedRows[index];
      if (row.kind === 'member') {
        map.set(row.item.id, index);
      }
    }
    return map;
  }, [flattenedRows]);

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - 10);
    const end = Math.min(flattenedRows.length, start + Math.ceil(VIRTUAL_CONTAINER_HEIGHT / VIRTUAL_ROW_HEIGHT) + 20);
    return { start, end };
  }, [flattenedRows.length, scrollTop]);

  const virtualRows = useMemo(() => {
    return flattenedRows.slice(visibleRange.start, visibleRange.end).map((row, offset) => {
      const index = visibleRange.start + offset;
      return {
        row,
        index,
        top: index * VIRTUAL_ROW_HEIGHT,
      };
    });
  }, [flattenedRows, visibleRange.end, visibleRange.start]);

  useEffect(() => {
    setActiveMemberIndex(0);
  }, [memberSearch]);

  useEffect(() => {
    if (!activeMember?.id || !explorerRef.current) return;
    const rowIndex = flattenedRowIndexByMemberId.get(activeMember.id);
    if (rowIndex === undefined) return;

    const top = rowIndex * VIRTUAL_ROW_HEIGHT;
    const bottom = top + VIRTUAL_ROW_HEIGHT;
    const container = explorerRef.current;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + VIRTUAL_CONTAINER_HEIGHT;

    if (top < viewTop) {
      container.scrollTop = top;
    } else if (bottom > viewBottom) {
      container.scrollTop = bottom - VIRTUAL_CONTAINER_HEIGHT;
    }
  }, [activeMember?.id, flattenedRowIndexByMemberId]);

  const pushRecentMember = useCallback((memberId: string) => {
    setRecentMemberIds((current) => {
      const next = updateRecentMembers(current, memberId);
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const insertMember = useCallback(
    (member: MemberItem) => {
      try {
        const nextDraft = insertMemberIntoQueryDraft(queryDraft, member);
        setQueryDraft(nextDraft);
        setNotice(`Inserted ${member.name} into ${member.type === 'measure' ? 'measures' : 'dimensions'}.`);
        pushRecentMember(member.id);
      } catch {
        setError('Query JSON is invalid. Fix JSON before inserting members.');
      }
    },
    [pushRecentMember, queryDraft]
  );

  const copyMember = useCallback(
    async (member: MemberItem) => {
      try {
        await navigator.clipboard.writeText(member.name);
        setNotice(`Copied ${member.name}`);
        pushRecentMember(member.id);
      } catch {
        setError('Clipboard write failed.');
      }
    },
    [pushRecentMember]
  );

  const runCubeLoad = useCallback(async () => {
    if (!cubeReady) {
      setError(`Cube is ${formatServiceState(cubeState)}. Cube query execution is disabled.`);
      return;
    }
    if (!parsedCubeQuery) return;
    if (semanticValidationErrors.length > 0) {
      setError(semanticValidationErrors.join(' | '));
      return;
    }
    try {
      setExecuting('cube');
      setError(null);
      setNotice(null);
      const response = await runCubeQuery(parsedCubeQuery, 'load');
      setCubeResult(response);
      setNotice('Cube query executed successfully.');
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Failed to execute cube query');
    } finally {
      setExecuting(null);
    }
  }, [parsedCubeQuery, cubeReady, cubeState, semanticValidationErrors]);

  const compileCubeSql = useCallback(async () => {
    if (!cubeReady) {
      setError(`Cube is ${formatServiceState(cubeState)}. SQL compilation from Cube is disabled.`);
      return;
    }
    if (!parsedCubeQuery) return;
    if (semanticValidationErrors.length > 0) {
      setError(semanticValidationErrors.join(' | '));
      return;
    }
    try {
      setExecuting('cube-sql');
      setError(null);
      const response = await runCubeQuery(parsedCubeQuery, 'sql');
      setCubeSqlResult(response);
      setNotice('Compiled SQL metadata refreshed.');
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Failed to compile cube SQL');
    } finally {
      setExecuting(null);
    }
  }, [parsedCubeQuery, cubeReady, cubeState, semanticValidationErrors]);

  const runSql = useCallback(async () => {
    try {
      setExecuting('sql');
      setError(null);
      const response = await runSqliteQuery(sqlDraft, 300);
      setSqlResult(response);
      setNotice('SQL executed successfully.');
    } catch (sqlError) {
      setError(sqlError instanceof Error ? sqlError.message : 'Failed to execute SQL');
    } finally {
      setExecuting(null);
    }
  }, [sqlDraft]);

  const cubeDataRows = useMemo(() => {
    const data = cubeResult?.payload?.data;
    if (!Array.isArray(data)) return [];
    return data as Array<Record<string, unknown>>;
  }, [cubeResult]);

  const cubeColumns = useMemo(() => {
    if (cubeDataRows.length === 0) return [];
    return Object.keys(cubeDataRows[0]);
  }, [cubeDataRows]);

  const sqlInspector = useMemo(() => {
    return cubeSqlResult?.normalized_sql || null;
  }, [cubeSqlResult]);

  const onSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (filteredMembers.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMemberIndex((index) => Math.min(filteredMembers.length - 1, index + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMemberIndex((index) => Math.max(0, index - 1));
      } else if (event.key === 'Enter' && activeMember) {
        event.preventDefault();
        insertMember(activeMember);
      }
    },
    [activeMember, filteredMembers.length, insertMember]
  );

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Modeling / Query Lab</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">Cube Query Workspace</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Build semantic queries, inspect generated SQL, and run raw SQLite queries from a single workspace.
        </p>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-2">
        <div className="flex flex-wrap gap-2">
          <Button variant={tab === 'cube' ? 'default' : 'ghost'} onClick={() => setTab('cube')}>
            <Braces className="h-4 w-4" /> Cube Query
          </Button>
          <Button variant={tab === 'sql' ? 'default' : 'ghost'} onClick={() => setTab('sql')}>
            <Database className="h-4 w-4" /> SQL
          </Button>
          <Button variant="ghost" onClick={() => loadMeta()} disabled={!cubeReady}>
            <RefreshCcw className="h-4 w-4" /> Refresh Meta
          </Button>
          <Badge variant={cubeReady ? 'success' : 'warning'}>
            Cube: {formatServiceState(cubeState)}
          </Badge>
          {loadingMeta ? <Badge variant="secondary">Loading meta...</Badge> : <Badge variant="outline">{allMembers.length} members</Badge>}
          {notice ? <Badge variant="success">{notice}</Badge> : null}
          {error ? <Badge variant="warning">{error}</Badge> : null}
        </div>
      </section>

      {tab === 'cube' && !cubeReady ? (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          Cube query mode is temporarily unavailable because Cube is {formatServiceState(cubeState)}. SQL mode remains fully available.
        </section>
      ) : null}

      {tab === 'cube' ? (
        <section className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Semantic Member Explorer</CardTitle>
              <CardDescription>Search all measures/dimensions, use keyboard navigation, and insert members into JSON.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                <input
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search member, cube, or type"
                  disabled={!cubeReady}
                  className="h-10 w-full rounded-lg border border-white/10 bg-black/25 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/25 focus:outline-none"
                />
              </div>

              {recentMembers.length > 0 ? (
                <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Recent</p>
                  <div className="flex flex-wrap gap-1.5">
                    {recentMembers.slice(0, 8).map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => insertMember(member)}
                        disabled={!cubeReady}
                        title={member.name}
                        className="max-w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-left text-xs text-zinc-200 hover:border-white/20"
                      >
                        <span className="block max-w-[210px] truncate">{member.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div
                ref={explorerRef}
                className="relative overflow-y-auto rounded-lg border border-white/10 bg-black/20"
                style={{ height: `${VIRTUAL_CONTAINER_HEIGHT}px` }}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                <div style={{ height: `${flattenedRows.length * VIRTUAL_ROW_HEIGHT}px`, position: 'relative' }}>
                  {virtualRows.map(({ row, top }) => {
                    if (row.kind === 'header') {
                      return (
                        <div
                          key={`header-${row.label}-${top}`}
                          style={{ top: `${top}px`, height: `${VIRTUAL_ROW_HEIGHT}px` }}
                          className="absolute left-0 right-0 border-b border-white/5 bg-zinc-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500"
                        >
                          {row.label}
                        </div>
                      );
                    }

                    const member = row.item;
                    const isActive = activeMember?.id === member.id;
                    return (
                      <div
                        key={member.id}
                        style={{ top: `${top}px`, height: `${VIRTUAL_ROW_HEIGHT}px` }}
                        className={`absolute left-0 right-0 flex items-center gap-2 border-b border-white/5 px-2 ${
                          isActive ? 'bg-white/10' : 'bg-transparent'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => insertMember(member)}
                          disabled={!cubeReady}
                          title={member.name}
                          className="min-w-0 flex-1 rounded px-2 py-1 text-left hover:bg-black/40"
                        >
                          <span className="block truncate font-mono text-xs text-zinc-200">{member.name}</span>
                          <span className="block truncate text-[10px] text-zinc-500">{member.title}</span>
                        </button>
                        <Badge variant={member.type === 'measure' ? 'success' : 'outline'} className="hidden sm:inline-flex">
                          {member.type}
                        </Badge>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copyMember(member)} disabled={!cubeReady}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-zinc-500">Arrow keys move selection, Enter inserts selected member.</p>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Cube Query Editor</CardTitle>
              <CardDescription>
                Execute `/cubejs-api/v1/load` and inspect SQL planner output from `/cubejs-api/v1/sql` (inspection only, not a direct execution path).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={queryDraft}
                onChange={(event) => setQueryDraft(event.target.value)}
                rows={14}
                className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-zinc-200 focus:border-white/20 focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => runCubeLoad()} disabled={!queryReadyForExecution || Boolean(executing) || !cubeReady}>
                  {executing === 'cube' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Execute Query
                </Button>
                <Button variant="secondary" onClick={() => compileCubeSql()} disabled={!queryReadyForExecution || Boolean(executing) || !cubeReady}>
                  {executing === 'cube-sql' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Braces className="h-4 w-4" />} Compile SQL
                </Button>
                {!parsedCubeQuery ? <Badge variant="warning">Invalid JSON query</Badge> : null}
                {semanticValidationErrors.length > 0 ? <Badge variant="warning">{semanticValidationErrors.length} semantic issue(s)</Badge> : null}
              </div>
              {semanticValidationErrors.length > 0 ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                  {semanticValidationErrors.map((entry) => (
                    <p key={entry}>{entry}</p>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>Cube Query Results</CardTitle>
              <CardDescription>Semantic-layer response payload and result rows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">SQL Inspector</p>
                {sqlInspector ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={sqlInspector.status === 'ok' ? 'success' : 'warning'}>Planner: {sqlInspector.status}</Badge>
                      {sqlInspector.query_type ? <Badge variant="outline">Type: {sqlInspector.query_type}</Badge> : null}
                      <Badge variant="outline">Attempts: {cubeSqlResult?.attempts ?? 0}</Badge>
                      <Badge variant="outline">Continue wait: {cubeSqlResult?.continue_wait_count ?? 0}</Badge>
                    </div>

                    {sqlInspector.error ? (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                        {sqlInspector.error}
                      </div>
                    ) : null}

                    {sqlInspector.warnings.length > 0 ? (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                        {sqlInspector.warnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    ) : null}

                    <div className="rounded-md border border-white/10 bg-black/25 p-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Generated SQL</p>
                      <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">
                        {sqlInspector.sql_text || '// sql text not available'}
                      </pre>
                    </div>

                    <div className="rounded-md border border-white/10 bg-black/25 p-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">SQL Params</p>
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">
                        {sqlInspector.sql_params === undefined ? 'null' : stringifyPretty(sqlInspector.sql_params)}
                      </pre>
                    </div>

                    <div className="rounded-md border border-white/10 bg-black/25 p-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Raw Payload</p>
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-500">
                        {stringifyPretty(cubeSqlResult?.payload || {})}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-400">
                    {'// compile a query to inspect Cube SQL planner output'}
                  </pre>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    {cubeColumns.length === 0 ? <TableHead>Result</TableHead> : cubeColumns.map((column) => <TableHead key={column}>{column}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cubeDataRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={Math.max(cubeColumns.length, 1)} className="text-zinc-500">
                        Execute a Cube query to see result rows.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cubeDataRows.map((row, rowIndex) => (
                      <TableRow key={`cube-row-${rowIndex}`}>
                        {cubeColumns.map((column) => (
                          <TableCell key={`${rowIndex}-${column}`} className="font-mono text-xs text-zinc-300">
                            {String(row[column] ?? '-')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      ) : (
        <section>
          <Card>
            <CardHeader>
              <CardTitle>SQLite SQL Runner</CardTitle>
              <CardDescription>Read-only SQL execution against SeFi SQLite for fast model validation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={sqlDraft}
                onChange={(event) => setSqlDraft(event.target.value)}
                rows={8}
                className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-zinc-200 focus:border-white/20 focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => runSql()} disabled={Boolean(executing)}>
                  {executing === 'sql' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run SQL
                </Button>
                {sqlResult?.truncated ? <Badge variant="warning">Rows truncated at {sqlResult.max_rows}</Badge> : null}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    {sqlResult?.columns?.length ? sqlResult.columns.map((column) => <TableHead key={column}>{column}</TableHead>) : <TableHead>Result</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sqlResult?.rows?.length ? (
                    sqlResult.rows.map((row, rowIndex) => (
                      <TableRow key={`sql-row-${rowIndex}`}>
                        {(sqlResult.columns || []).map((column) => (
                          <TableCell key={`${rowIndex}-${column}`} className="font-mono text-xs text-zinc-300">
                            {String(row[column] ?? '-')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={Math.max(sqlResult?.columns?.length || 0, 1)} className="text-zinc-500">
                        Run a SQL statement to view rows.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
